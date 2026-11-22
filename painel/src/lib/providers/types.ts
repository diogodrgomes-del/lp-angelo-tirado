import type { AmountUnit } from '../money';
import type { Tracking } from '../tracking';

export type SaleStatus = 'approved' | 'pending' | 'refused' | 'refunded' | 'chargeback' | 'canceled';
export type PaymentMethod = 'card' | 'pix' | 'boleto' | 'other';

export interface NormalizedSale {
  /** ID do PEDIDO: o que sobrevive à mudança de status. Nunca o do checkout. */
  externalId: string;
  status: SaleStatus;
  paymentMethod: PaymentMethod;
  productId: string | null;
  productName: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  /** cobrado do comprador, com orderbump */
  grossCents: number;
  /** o que fica com o produtor; pode ser negativo */
  netCents: number;
  orderedAt: Date;
  /** só preenchido quando o evento prova o pagamento */
  paidAt: Date | null;
  refundedAt: Date | null;
  tracking: Tracking;
}

export type ParseResult =
  | { kind: 'sale'; eventName: string | null; sale: NormalizedSale }
  | { kind: 'ignored'; eventName: string | null; reason: string }
  | { kind: 'error'; eventName: string | null; error: string };

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
  url: URL;
}

export interface CheckoutProvider {
  id: string;
  label: string;
  /** Unidade dos valores na API. Declarada, nunca adivinhada. null = falta configurar. */
  amountUnit: () => AmountUnit | null;
  /** Onde o segredo deve ser colado na plataforma — mostrado na tela de integrações. */
  secretHelp: string;
  /** true quando o segredo confere. */
  verify(req: WebhookRequest, secret: string): boolean;
  parse(payload: unknown): ParseResult;
  /** O mapeamento já foi conferido contra um payload real? */
  verified: boolean;
}

export class MappingError extends Error {}

/** Lê um caminho "a.b.c" num objeto. */
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Primeiro caminho com valor não vazio. */
export function pickFirst(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = pick(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Hierarquia de status: um evento atrasado nunca rebaixa o estado já conhecido. */
const RANK: Record<SaleStatus, number> = {
  pending: 0,
  refused: 0,
  canceled: 0,
  approved: 1,
  refunded: 2,
  chargeback: 2,
};

export function mergeStatus(current: SaleStatus | null, incoming: SaleStatus): SaleStatus {
  if (!current) return incoming;
  return RANK[incoming] >= RANK[current] ? incoming : current;
}
