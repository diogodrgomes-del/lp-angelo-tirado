import { createHash } from 'node:crypto';
import { META_API_VERSION } from './meta';

/**
 * Conversions API: manda cada venda aprovada direto do servidor para o pixel.
 * O pixel do navegador perde compras por bloqueador, iOS e aba fechada cedo.
 *
 * Sem fbc/fbp/IP/user agent o evento é ACEITO, não dá erro, e não atribui a
 * campanha nenhuma. Os identificadores vêm de extractTracking, que lê os
 * vários formatos de rastreamento das plataformas.
 */

export interface CapiSale {
  platform: string;
  externalId: string;
  grossCents: number;
  productName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerName: string | null;
  orderedAt: Date;
  paidAt: Date | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

/** _fbc a partir do fbclid, no formato que o pixel usaria: fb.1.<ms>.<fbclid> */
export function fbcFrom(sale: Pick<CapiSale, 'fbc' | 'fbclid' | 'orderedAt'>): string | null {
  if (sale.fbc) return sale.fbc;
  if (sale.fbclid) return `fb.1.${sale.orderedAt.getTime()}.${sale.fbclid}`;
  return null;
}

export function buildPurchaseEvent(sale: CapiSale) {
  const user: Record<string, unknown> = {};
  const email = sale.customerEmail?.trim().toLowerCase();
  if (email) {
    user.em = [sha(email)];
    user.external_id = [sha(email)];
  }
  const phone = normalizePhone(sale.customerPhone);
  if (phone) user.ph = [sha(phone)];
  if (sale.customerName) {
    const parts = sale.customerName.trim().toLowerCase().split(/\s+/);
    if (parts[0]) user.fn = [sha(parts[0])];
    if (parts.length > 1) user.ln = [sha(parts[parts.length - 1])];
  }
  const fbc = fbcFrom(sale);
  if (fbc) user.fbc = fbc;
  if (sale.fbp) user.fbp = sale.fbp;
  if (sale.clientIp) user.client_ip_address = sale.clientIp;
  if (sale.userAgent) user.client_user_agent = sale.userAgent;
  user.country = [sha('br')];

  return {
    event_name: 'Purchase',
    event_time: Math.floor((sale.paidAt ?? sale.orderedAt).getTime() / 1000),
    // mesmo id que o pixel do checkout usaria permite a Meta deduplicar
    event_id: `${sale.platform}:${sale.externalId}`,
    action_source: 'website',
    user_data: user,
    custom_data: {
      currency: 'BRL',
      value: sale.grossCents / 100,
      content_name: sale.productName,
      order_id: sale.externalId,
    },
  };
}

/** Quantos identificadores de atribuição o evento leva (para auditoria). */
export function attributionSignals(sale: CapiSale): string[] {
  const s: string[] = [];
  if (fbcFrom(sale)) s.push('fbc');
  if (sale.fbp) s.push('fbp');
  if (sale.clientIp) s.push('ip');
  if (sale.userAgent) s.push('ua');
  if (sale.customerEmail) s.push('email');
  return s;
}

export async function sendCapi(
  events: ReturnType<typeof buildPurchaseEvent>[],
  pixelId: string,
  token: string,
  testCode: string | null,
  f: typeof fetch = fetch,
): Promise<void> {
  const body: Record<string, unknown> = { data: events };
  if (testCode) body.test_event_code = testCode;
  const res = await f(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(pixelId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`CAPI: ${json.error?.message ?? `HTTP ${res.status}`}`);
}
