import { createHmac, timingSafeEqual } from 'node:crypto';
import { amountToCents, type AmountUnit } from '../money';
import { parseLocalDateTime } from '../dates';
import { extractTracking } from '../tracking';
import { pick, pickFirst, str, type CheckoutProvider, type PaymentMethod, type SaleStatus } from './types';

/**
 * Wiapy.
 *
 * ATENÇÃO — mapeamento ainda NÃO conferido contra um payload real deste
 * painel (verified: false). Por isso ele é estrito: se um campo obrigatório
 * não estiver num dos caminhos conhecidos, o evento vira "erro" e NENHUMA
 * venda é gravada. O payload cru fica salvo; depois de ajustar os caminhos,
 * "Reprocessar webhooks" recupera tudo.
 *
 * Armadilhas já comprovadas nesta plataforma:
 * - Total cobrado é `payment.amount` (com orderbump). `checkout.amount` é só
 *   o produto principal — ler ele subfatura toda venda com orderbump.
 * - O id do CHECKOUT também vem no evento de carrinho abandonado. Usá-lo
 *   transforma visitante em venda pendente. Só o id do pagamento/pedido serve.
 * - `dt_update` é "última alteração": em `paid` é quando entrou, em
 *   `refunded` é quando saiu. Nunca é data de pagamento de um reembolso.
 * - Rastreamento vem em `trackProps`.
 * - Unidade dos valores: definida em WIAPY_AMOUNT_UNIT ("cents" ou "decimal").
 *   Sem ela, todo evento vira erro — errar a unidade dá número 100× fora.
 */

const STATUS: Record<string, SaleStatus> = {
  paid: 'approved',
  approved: 'approved',
  aprovado: 'approved',
  pago: 'approved',
  completed: 'approved',
  pending: 'pending',
  waiting_payment: 'pending',
  aguardando: 'pending',
  pendente: 'pending',
  processing: 'pending',
  refused: 'refused',
  recusado: 'refused',
  declined: 'refused',
  failed: 'refused',
  refunded: 'refunded',
  reembolsado: 'refunded',
  chargeback: 'chargeback',
  chargedback: 'chargeback',
  disputed: 'chargeback',
  canceled: 'canceled',
  cancelled: 'canceled',
  cancelado: 'canceled',
  expired: 'canceled',
  expirado: 'canceled',
};

const NOT_SALE = /abandon|cart|carrinho|checkout[._ ]?(session|created|started|view)|saque|withdraw|payout|transfer/i;

const ID_PATHS = ['payment.id', 'payment.payment_id', 'order.id', 'order_id', 'transaction.id', 'transaction_id', 'sale.id'];
const STATUS_PATHS = ['payment.status', 'order.status', 'transaction.status', 'status'];
const GROSS_PATHS = ['payment.amount', 'order.amount', 'transaction.amount']; // NUNCA checkout.amount
const NET_PATHS = [
  'payment.net_amount',
  'payment.liquid_amount',
  'payment.amount_liquid',
  'payment.producer_amount',
  'payment.seller_amount',
  'payment.net',
  'commission.amount',
  'commissions.producer',
  'net_amount',
];
const METHOD_PATHS = ['payment.method', 'payment.payment_method', 'payment.type', 'payment_method', 'method'];
const CREATED_PATHS = ['payment.dt_created', 'payment.created_at', 'order.dt_created', 'dt_created', 'created_at'];
const PAID_PATHS = ['payment.dt_paid', 'payment.paid_at', 'payment.dt_approved', 'dt_paid', 'paid_at', 'approved_at'];
const EVENT_PATHS = ['event', 'event_type', 'type', 'webhook_event', 'name'];

function method(v: unknown): PaymentMethod {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('pix')) return 'pix';
  if (s.includes('boleto') || s.includes('billet') || s.includes('bank_slip')) return 'boleto';
  if (s.includes('card') || s.includes('cartao') || s.includes('cartão') || s.includes('credit')) return 'card';
  return 'other';
}

export function wiapyUnit(): AmountUnit | null {
  const u = process.env.WIAPY_AMOUNT_UNIT?.trim().toLowerCase();
  return u === 'cents' || u === 'decimal' ? u : null;
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const wiapy: CheckoutProvider = {
  id: 'wiapy',
  label: 'Wiapy',
  verified: false,
  amountUnit: wiapyUnit,
  secretHelp:
    'Defina o mesmo segredo aqui e na Wiapy. O painel aceita o segredo no cabeçalho ' +
    '(x-webhook-token ou Authorization: Bearer), como ?token= na URL, ou como assinatura HMAC-SHA256 em x-signature.',

  verify(req, secret) {
    const h = req.headers;
    const candidates = [
      req.url.searchParams.get('token'),
      h.get('x-webhook-token'),
      h.get('x-wiapy-token'),
      h.get('x-webhook-secret'),
      h.get('authorization')?.replace(/^Bearer\s+/i, ''),
    ].filter((v): v is string => !!v);
    if (candidates.some((c) => safeEq(c, secret))) return true;
    const sig = h.get('x-signature') ?? h.get('x-wiapy-signature');
    if (sig) {
      const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex');
      return safeEq(sig.replace(/^sha256=/, ''), expected);
    }
    return false;
  },

  parse(payload) {
    const eventName = str(pickFirst(payload, EVENT_PATHS));
    if (eventName && NOT_SALE.test(eventName)) {
      return { kind: 'ignored', eventName, reason: `evento "${eventName}" não é venda` };
    }
    // sem pagamento/pedido = sessão de checkout ou carrinho: não é venda
    const externalId = str(pickFirst(payload, ID_PATHS));
    if (!externalId) {
      return { kind: 'ignored', eventName, reason: 'sem id de pagamento/pedido (sessão de checkout ou carrinho)' };
    }

    const unit = wiapyUnit();
    if (!unit) {
      return {
        kind: 'error',
        eventName,
        error: 'WIAPY_AMOUNT_UNIT não configurada ("cents" ou "decimal"). Configure e reprocesse.',
      };
    }

    const rawStatus = String(pickFirst(payload, STATUS_PATHS) ?? '').toLowerCase();
    const status = STATUS[rawStatus];
    if (!status) return { kind: 'error', eventName, error: `status desconhecido: "${rawStatus}"` };

    try {
      const gross = pickFirst(payload, GROSS_PATHS);
      if (gross === undefined) throw new Error(`total cobrado ausente (procurado em ${GROSS_PATHS.join(', ')})`);
      const net = pickFirst(payload, NET_PATHS);
      if (net === undefined) throw new Error(`valor líquido ausente (procurado em ${NET_PATHS.join(', ')})`);

      const update = parseLocalDateTime(pickFirst(payload, ['payment.dt_update', 'dt_update', 'updated_at']));
      const orderedAt = parseLocalDateTime(pickFirst(payload, CREATED_PATHS)) ?? (status === 'pending' ? update : null);
      if (!orderedAt) throw new Error('data do pedido ausente');

      let paidAt = parseLocalDateTime(pickFirst(payload, PAID_PATHS));
      // dt_update só vale como data de pagamento QUANDO o status é pago
      if (!paidAt && status === 'approved') paidAt = update;
      const refundedAt = status === 'refunded' || status === 'chargeback' ? update : null;

      return {
        kind: 'sale',
        eventName,
        sale: {
          externalId,
          status,
          paymentMethod: method(pickFirst(payload, METHOD_PATHS)),
          productId: str(pickFirst(payload, ['product.id', 'checkout.product.id', 'offer.product_id'])),
          productName:
            str(pickFirst(payload, ['product.name', 'checkout.product.name', 'offer.name', 'checkout.name'])) ??
            'Produto sem nome',
          customerName: str(pickFirst(payload, ['customer.name', 'client.name', 'buyer.name'])),
          customerEmail:
            str(pickFirst(payload, ['customer.email', 'client.email', 'buyer.email']))?.toLowerCase() ?? null,
          customerPhone: str(pickFirst(payload, ['customer.phone', 'client.phone', 'buyer.phone'])),
          grossCents: amountToCents(gross, unit),
          // líquido preserva o sinal: venda de R$ 2,00 com taxa de R$ 2,11 = -R$ 0,11
          netCents: amountToCents(net, unit),
          orderedAt,
          paidAt: status === 'pending' || status === 'refused' || status === 'canceled' ? null : paidAt,
          refundedAt,
          tracking: extractTracking(payload),
        },
      };
    } catch (e) {
      return { kind: 'error', eventName, error: (e as Error).message };
    }
  },
};
