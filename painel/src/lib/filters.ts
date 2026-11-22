import { PERIODS, type PeriodId } from './dates';

/** Filtros do topo. Ficam na query string: o link compartilhado abre igual. */
export interface Filters {
  period: PeriodId;
  account: string; // id da conta de anúncio ou ''
  source: string; // fonte de tráfego (Meta, Google, Direto…) ou ''
  platform: string; // plataforma de checkout ou ''
  product: string; // productKey ou ''
  method: string; // card | pix | boleto | ''
  medium: string; // utm_medium ou ''
  campaign: string; // utm_campaign ou ''
  status: string; // só na aba Vendas
}

export const FILTER_KEYS = ['period', 'account', 'source', 'platform', 'product', 'method', 'medium', 'campaign', 'status'] as const;

type SP = Record<string, string | string[] | undefined> | URLSearchParams;

function get(sp: SP, k: string): string {
  const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? '').slice(0, 300);
}

export function parseFilters(sp: SP): Filters {
  const period = get(sp, 'period');
  return {
    period: (PERIODS.some((p) => p.id === period) ? period : 'hoje') as PeriodId,
    account: get(sp, 'account'),
    source: get(sp, 'source'),
    platform: get(sp, 'platform'),
    product: get(sp, 'product'),
    method: ['card', 'pix', 'boleto', 'other'].includes(get(sp, 'method')) ? get(sp, 'method') : '',
    medium: get(sp, 'medium'),
    campaign: get(sp, 'campaign'),
    status: get(sp, 'status'),
  };
}

export function filtersToQuery(f: Partial<Filters>): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v && !(k === 'period' && v === 'hoje')) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
