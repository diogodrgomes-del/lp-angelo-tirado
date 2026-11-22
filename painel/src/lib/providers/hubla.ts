import { timingSafeEqual } from 'node:crypto';
import { amountToCents } from '../money';
import { parseLocalDateTime } from '../dates';
import { extractTracking, type Tracking } from '../tracking';
import { pick, pickFirst, str, type CheckoutProvider, type PaymentMethod, type SaleStatus } from './types';

/**
 * Hubla (webhooks v2: { type, version, event: { product, invoice, user } }).
 *
 * ATENÇÃO — mapeamento ainda NÃO conferido contra um payload real desta conta
 * (verified: false). É estrito: se um campo obrigatório não estiver num dos
 * caminhos conhecidos, o evento vira "erro" e NENHUMA venda é gravada. O
 * payload cru fica salvo; depois do ajuste, "Reprocessar webhooks" recupera.
 *
 * - Só eventos "invoice.*" são venda. lead.*, customer.*, subscription.* são
 *   ignorados (carrinho abandonado vem como lead e não pode virar pendente).
 * - ID do pedido: event.invoice.id (o mesmo do criado ao pago/reembolsado).
 * - Valores: só campos que terminam em "Cents" — a unidade vem no nome, não
 *   é adivinhada. Campo sem "Cents" não é lido.
 * - Datas ISO com fuso (respeitado); sem fuso = Brasília.
 * - Token: cabeçalho x-hubla-token (ou ?token=, x-webhook-token, Bearer).
 */

const STATUS: Record<string, SaleStatus> = {
  paid: 'approved',
  approved: 'approved',
  succeeded: 'approved',
  payment_succeeded: 'approved',
  unpaid: 'pending',
  pending: 'pending',
  waiting_payment: 'pending',
  created: 'pending',
  processing: 'pending',
  failed: 'refused',
  payment_failed: 'refused',
  refused: 'refused',
  declined: 'refused',
  refunded: 'refunded',
  partially_refunded: 'refunded',
  chargeback: 'chargeback',
  chargedback: 'chargeback',
  disputed: 'chargeback',
  expired: 'canceled',
  canceled: 'canceled',
  cancelled: 'canceled',
  voided: 'canceled',
};

/** Status pelo tipo do evento, quando o invoice.status não vier. */
function statusFromType(type: string): SaleStatus | undefined {
  const t = type.toLowerCase();
  if (/payment_succeeded|\.paid$/.test(t)) return 'approved';
  if (/refund/.test(t)) return 'refunded';
  if (/chargeback|dispute/.test(t)) return 'chargeback';
  if (/payment_failed|refused/.test(t)) return 'refused';
  if (/expired|canceled|cancelled/.test(t)) return 'canceled';
  if (/invoice\.created/.test(t)) return 'pending';
  return undefined;
}

function method(v: unknown): PaymentMethod {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('pix')) return 'pix';
  if (s.includes('boleto') || s.includes('bank_slip') || s.includes('billet')) return 'boleto';
  if (s.includes('card') || s.includes('credit') || s.includes('cartao')) return 'card';
  return 'other';
}

const INV = 'event.invoice';

/** Líquido do produtor: recebedor com papel de vendedor/produtor. */
function sellerNet(payload: unknown): unknown {
  const receivers = pick(payload, `${INV}.receivers`);
  if (Array.isArray(receivers)) {
    const seller = receivers.find((r) =>
      /seller|producer|owner|vendedor|produtor/i.test(String((r as Record<string, unknown>)?.role ?? '')),
    ) as Record<string, unknown> | undefined;
    if (seller) {
      const v = seller.netCents ?? seller.totalCents ?? seller.amountCents;
      if (v !== undefined) return v;
    }
  }
  return pickFirst(payload, [`${INV}.amount.netCents`, `${INV}.netCents`, `${INV}.sellerNetCents`, `${INV}.amount.sellerCents`]);
}

function hublaTracking(payload: unknown): Tracking {
  const t = extractTracking(payload);
  // a Hubla escreve utm sem o prefixo: paymentSession.utm.{source,medium,...}
  const utm = pickFirst(payload, [`${INV}.paymentSession.utm`, `${INV}.utm`, 'event.utm', 'event.paymentSession.utm']);
  if (utm && typeof utm === 'object') {
    const u = utm as Record<string, unknown>;
    t.utmSource ??= str(u.source);
    t.utmMedium ??= str(u.medium);
    t.utmCampaign ??= str(u.campaign);
    t.utmContent ??= str(u.content);
    t.utmTerm ??= str(u.term);
  }
  const session = pick(payload, `${INV}.paymentSession`) as Record<string, unknown> | undefined;
  if (session && typeof session === 'object') {
    t.clientIp ??= str(session.ip ?? session.ipAddress);
    t.userAgent ??= str(session.userAgent ?? session.user_agent);
    // cookies do pixel no checkout: paymentSession.cookies.{fbp,fbc}
    const cookies = session.cookies as Record<string, unknown> | undefined;
    if (cookies && typeof cookies === 'object') {
      t.fbp ??= str(cookies.fbp ?? cookies._fbp);
      t.fbc ??= str(cookies.fbc ?? cookies._fbc);
    }
    // a Hubla não tem campo de UTM: elas vêm na URL do checkout
    const url = str(session.url);
    if (url && url.includes('?')) {
      try {
        const q = new URL(url).searchParams;
        t.utmSource ??= str(q.get('utm_source'));
        t.utmMedium ??= str(q.get('utm_medium'));
        t.utmCampaign ??= str(q.get('utm_campaign'));
        t.utmContent ??= str(q.get('utm_content'));
        t.utmTerm ??= str(q.get('utm_term'));
        t.fbclid ??= str(q.get('fbclid'));
        t.src ??= str(q.get('src'));
      } catch {
        /* URL inválida: ignora */
      }
    }
  }
  return t;
}

/** Quando a fatura entrou num status, pelo histórico statusAt [{status, when}]. */
function statusWhen(payload: unknown, wanted: RegExp): Date | null {
  const list = pick(payload, `${INV}.statusAt`);
  if (!Array.isArray(list)) return null;
  const hit = [...list].reverse().find((x) => wanted.test(String((x as Record<string, unknown>)?.status ?? '')));
  return hit ? parseLocalDateTime((hit as Record<string, unknown>).when) : null;
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hubla: CheckoutProvider = {
  id: 'hubla',
  label: 'Hubla',
  verified: false,
  amountUnit: () => 'cents',
  secretHelp:
    'Na Hubla: Integrações → Webhook → crie o webhook com a URL acima e copie o "Token" gerado; cole aqui. ' +
    'A Hubla manda esse token no cabeçalho x-hubla-token de cada envio.',

  verify(req, secret) {
    const h = req.headers;
    return [
      h.get('x-hubla-token'),
      h.get('x-webhook-token'),
      req.url.searchParams.get('token'),
      h.get('authorization')?.replace(/^Bearer\s+/i, ''),
    ].some((c) => !!c && safeEq(c, secret));
  },

  parse(payload) {
    const type = str(pickFirst(payload, ['type', 'event_type', 'eventType'])) ?? '';
    const eventName = type || null;
    if (!type.toLowerCase().startsWith('invoice.')) {
      return { kind: 'ignored', eventName, reason: `evento "${type || 'sem tipo'}" não é fatura (lead, assinatura ou membro)` };
    }
    const externalId = str(pick(payload, `${INV}.id`));
    if (!externalId) return { kind: 'error', eventName, error: 'event.invoice.id ausente' };

    const rawStatus = String(pick(payload, `${INV}.status`) ?? '').toLowerCase();
    const status = STATUS[rawStatus] ?? statusFromType(type);
    if (!status) return { kind: 'error', eventName, error: `status desconhecido: "${rawStatus}" (${type})` };

    try {
      const gross = pickFirst(payload, [`${INV}.amount.totalCents`, `${INV}.totalCents`, `${INV}.amountCents`]);
      if (gross === undefined) throw new Error('total ausente (procurado em event.invoice.amount.totalCents)');
      const net = sellerNet(payload);
      if (net === undefined) {
        throw new Error('valor líquido ausente (procurado em event.invoice.receivers[papel vendedor] e amount.netCents)');
      }
      const orderedAt = parseLocalDateTime(pickFirst(payload, [`${INV}.createdAt`, `${INV}.saleDate`, `${INV}.created_at`]));
      if (!orderedAt) throw new Error('data de criação da fatura ausente');
      const paidAt =
        parseLocalDateTime(pickFirst(payload, [`${INV}.paidAt`, `${INV}.paid_at`, `${INV}.approvedAt`])) ??
        statusWhen(payload, /^(paid|approved|succeeded)$/i);
      // data em que SAIU (reembolso/chargeback) — nunca usada como pagamento
      const updatedAt =
        statusWhen(payload, /refund|chargeback|dispute/i) ??
        parseLocalDateTime(pickFirst(payload, [`${INV}.refundedAt`, `${INV}.updatedAt`, `${INV}.modifiedAt`]));
      const approvedLike = status === 'approved' || status === 'refunded' || status === 'chargeback';

      const first = str(pickFirst(payload, ['event.user.firstName', 'event.payer.firstName']));
      const last = str(pickFirst(payload, ['event.user.lastName', 'event.payer.lastName']));
      return {
        kind: 'sale',
        eventName,
        sale: {
          externalId,
          status,
          paymentMethod: method(pickFirst(payload, [`${INV}.paymentMethod`, `${INV}.payment_method`])),
          productId: str(pickFirst(payload, ['event.products.0.id', `${INV}.productId`, 'event.product.id'])),
          productName: str(pickFirst(payload, ['event.products.0.name', 'event.product.name', `${INV}.productName`])) ?? 'Produto sem nome',
          customerName: [first, last].filter(Boolean).join(' ') || str(pickFirst(payload, ['event.user.name', 'event.payer.name'])),
          customerEmail: str(pickFirst(payload, ['event.user.email', 'event.payer.email']))?.toLowerCase() ?? null,
          customerPhone: str(pickFirst(payload, ['event.user.phone', 'event.payer.phone'])),
          grossCents: amountToCents(gross, 'cents'),
          netCents: amountToCents(net, 'cents'),
          orderedAt,
          // só fatura paga tem data de pagamento; updatedAt de reembolso NUNCA vira pagamento
          paidAt: approvedLike ? paidAt : null,
          refundedAt: status === 'refunded' || status === 'chargeback' ? updatedAt : null,
          tracking: hublaTracking(payload),
        },
      };
    } catch (e) {
      return { kind: 'error', eventName, error: (e as Error).message };
    }
  },
};
