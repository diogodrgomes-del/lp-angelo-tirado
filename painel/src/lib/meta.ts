import { decimalStringToCents } from './money';

/**
 * Cliente mínimo da Marketing API da Meta.
 *
 * O token da Meta enxerga TODAS as contas que a pessoa vê. Quem opera tráfego
 * para clientes tem dezenas. Por isso conta nova entra INATIVA quando o token
 * enxerga mais de uma (ver activationFor), e reconectar não desfaz a seleção.
 *
 * Token de usuário expira em ~60 dias e, quando expira, o gasto simplesmente
 * congela. O definitivo é um System User token do Business Manager.
 */

export const META_API_VERSION = process.env.META_API_VERSION || 'v24.0';
const BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export class MetaError extends Error {
  constructor(
    message: string,
    public code?: number,
    public isTokenError = false,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export async function graph<T = unknown>(
  path: string,
  params: Record<string, string>,
  token: string,
  f: Fetch = fetch,
): Promise<T> {
  const url = path.startsWith('http') ? new URL(path) : new URL(`${BASE}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (token && !url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  const res = await f(url, { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; type?: string } };
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    // 190 = token inválido/expirado
    throw new MetaError(`Meta Ads: ${e.message ?? `HTTP ${res.status}`}`, e.code, e.code === 190);
  }
  return body as T;
}

/** Segue a paginação ("paging.next") até o fim. */
export async function graphAll<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  f: Fetch = fetch,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, params, token, f);
  out.push(...(page.data ?? []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    page = await graph(page.paging.next, {}, token, f);
    out.push(...(page.data ?? []));
  }
  return out;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone_name?: string;
  balance?: string;
  account_status?: number;
}

export async function fetchAdAccounts(token: string, f: Fetch = fetch): Promise<MetaAdAccount[]> {
  return graphAll<MetaAdAccount>(
    'me/adaccounts',
    { fields: 'id,name,currency,timezone_name,balance,account_status', limit: '200' },
    token,
    f,
  );
}

export interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
}

export async function fetchInsights(
  accountId: string,
  token: string,
  since: string,
  until: string,
  f: Fetch = fetch,
): Promise<InsightRow[]> {
  return graphAll<InsightRow>(
    `${accountId}/insights`,
    {
      level: 'campaign',
      fields: 'campaign_id,campaign_name,spend,impressions,clicks',
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    },
    token,
    f,
  );
}

export interface MetaCampaign {
  id: string;
  name: string;
  effective_status?: string;
}

export async function fetchCampaigns(accountId: string, token: string, f: Fetch = fetch): Promise<MetaCampaign[]> {
  return graphAll<MetaCampaign>(`${accountId}/campaigns`, { fields: 'id,name,effective_status', limit: '500' }, token, f);
}

export interface DailySpend {
  campaignId: string;
  campaignName: string;
  date: string;
  spendCents: number;
  impressions: number;
  clicks: number;
}

/** "spend" vem como texto decimal ("123.45") na moeda da conta. Nada de parseFloat. */
export function parseInsight(r: InsightRow): DailySpend {
  return {
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    date: r.date_start,
    spendCents: r.spend ? decimalStringToCents(r.spend) : 0,
    impressions: r.impressions ? Number.parseInt(r.impressions, 10) || 0 : 0,
    clicks: r.clicks ? Number.parseInt(r.clicks, 10) || 0 : 0,
  };
}

/**
 * Estado ativo de cada conta depois de (re)conectar.
 * - Conta já conhecida: mantém a escolha feita (reconectar não desfaz seleção).
 * - Conta nova: ativa só se o token enxerga exatamente UMA conta.
 */
export function activationFor(fetchedIds: string[], known: Map<string, boolean>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const id of fetchedIds) {
    out.set(id, known.has(id) ? known.get(id)! : fetchedIds.length === 1);
  }
  return out;
}

/** Saldo da conta: a API devolve em centavos (unidade mínima da moeda). */
export function balanceCents(v: string | undefined): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/* ── OAuth (opcional — só com META_APP_ID e META_APP_SECRET) ────────────── */

export function oauthUrl(appId: string, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'ads_read');
  u.searchParams.set('response_type', 'code');
  return u.toString();
}

export async function exchangeCode(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string,
  f: Fetch = fetch,
): Promise<{ token: string; expiresAt: Date | null }> {
  const short = await graph<{ access_token: string }>(
    'oauth/access_token',
    { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    '',
    f,
  );
  // troca por token de longa duração (~60 dias)
  const long = await graph<{ access_token: string; expires_in?: number }>(
    'oauth/access_token',
    {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    },
    '',
    f,
  );
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}
