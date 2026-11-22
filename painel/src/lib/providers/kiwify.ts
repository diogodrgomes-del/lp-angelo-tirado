import { createHmac, timingSafeEqual } from 'node:crypto';
import { amountToCents } from '../money';
import { parseLocalDateTime } from '../dates';
import { extractTracking } from '../tracking';
import { pick, pickFirst, str, type CheckoutProvider, type PaymentMethod, type SaleStatus } from './types';

/**
 * Kiwify.
 * - Valores em CENTAVOS inteiros (Commissions.charge_amount = 9700 → R$ 97,00).
 * - ID do pedido: order_id (o mesmo do começo ao fim). Carrinho abandonado não
 *   tem order_id e é ignorado.
 * - Datas sem fuso ("2026-01-10 14:22"), em horário de Brasília.
 * - Assinatura: ?signature= com HMAC-SHA1 do corpo cru usando o token do webhook.
 */

const STATUS: Record<string, SaleStatus> = {
  paid: 'approved',
  approved: 'approved',
  waiting_payment: 'pending',
  pending: 'pending',
  refused: 'refused',
  refunded: 'refunded',
  chargedback: 'chargeback',
  chargeback: 'chargeback',
  canceled: 'canceled',
  cancelled: 'canceled',
};

/** Eventos que NÃO são venda, mesmo trazendo id e valor. */
const NOT_SALE = /abandon|cart|checkout_session|saque|withdraw|payout/i;

function method(v: unknown): PaymentMethod {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('pix')) return 'pix';
  if (s.includes('boleto') || s.includes('billet')) return 'boleto';
  if (s.includes('card') || s.includes('cartao') || s.includes('credit')) return 'card';
  return 'other';
}

export const kiwify: CheckoutProvider = {
  id: 'kiwify',
  label: 'Kiwify',
  verified: false,
  amountUnit: () => 'cents',
  secretHelp:
    'Na Kiwify: Apps → Webhooks → o webhook → copie o "Token" e cole aqui. A Kiwify assina cada envio com ele.',

  verify(req, secret) {
    const sig = req.url.searchParams.get('signature') ?? '';
    const expected = createHmac('sha1', secret).update(req.rawBody).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parse(payload) {
    const eventName = str(pick(payload, 'webhook_event_type')) ?? str(pick(payload, 'order_status'));
    if (eventName && NOT_SALE.test(eventName)) {
      return { kind: 'ignored', eventName, reason: `evento "${eventName}" não é venda` };
    }
    const externalId = str(pick(payload, 'order_id'));
    if (!externalId) {
      return { kind: 'ignored', eventName, reason: 'sem order_id (carrinho abandonado ou evento que não é pedido)' };
    }
    const rawStatus = String(pick(payload, 'order_status') ?? '').toLowerCase();
    const status = STATUS[rawStatus];
    if (!status) return { kind: 'error', eventName, error: `order_status desconhecido: "${rawStatus}"` };

    try {
      const gross = pickFirst(payload, ['Commissions.charge_amount', 'Commissions.product_base_price']);
      const net = pick(payload, 'Commissions.my_commission');
      if (gross === undefined) throw new Error('Commissions.charge_amount ausente');
      if (net === undefined) throw new Error('Commissions.my_commission ausente');

      const orderedAt = parseLocalDateTime(pick(payload, 'created_at'));
      if (!orderedAt) throw new Error('created_at ausente ou inválido');
      const approved = parseLocalDateTime(pick(payload, 'approved_date'));
      const refunded = parseLocalDateTime(pick(payload, 'refunded_at'));

      return {
        kind: 'sale',
        eventName,
        sale: {
          externalId,
          status,
          paymentMethod: method(pick(payload, 'payment_method')),
          productId: str(pick(payload, 'Product.product_id')),
          productName: str(pick(payload, 'Product.product_name')) ?? 'Produto sem nome',
          customerName: str(pickFirst(payload, ['Customer.full_name', 'Customer.first_name'])),
          customerEmail: str(pick(payload, 'Customer.email'))?.toLowerCase() ?? null,
          customerPhone: str(pick(payload, 'Customer.mobile')),
          grossCents: amountToCents(gross, 'cents'),
          netCents: amountToCents(net, 'cents'),
          orderedAt,
          // só existe data de pagamento se o pedido foi aprovado em algum momento
          paidAt: status === 'approved' || status === 'refunded' || status === 'chargeback' ? approved : null,
          refundedAt: status === 'refunded' || status === 'chargeback' ? refunded : null,
          tracking: extractTracking(payload),
        },
      };
    } catch (e) {
      return { kind: 'error', eventName, error: (e as Error).message };
    }
  },
};
