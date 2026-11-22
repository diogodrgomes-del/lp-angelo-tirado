/**
 * Rastreamento (UTM, fbclid, _fbc, _fbp, IP, user agent) vindo do checkout.
 *
 * Cada plataforma aninha isso num lugar diferente e com grafias diferentes:
 * uma usa `trackProps`, outra `tracking` ou `TrackingParameters`; uma escreve
 * `user_agent`, outra `useragent`. Ler só o formato de uma faz as vendas da
 * outra irem para a Meta sem identificador NENHUM — aceito, sem erro, e sem
 * atribuir campanha. Por isso a busca aqui é tolerante a ninho e grafia.
 */

export interface Tracking {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  src: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

export const EMPTY_TRACKING: Tracking = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  src: null,
  fbclid: null,
  fbc: null,
  fbp: null,
  clientIp: null,
  userAgent: null,
};

/** chave normalizada (minúscula, só letras e dígitos) → campo */
const ALIASES: Record<string, keyof Tracking> = {
  utmsource: 'utmSource',
  utmmedium: 'utmMedium',
  utmcampaign: 'utmCampaign',
  utmcontent: 'utmContent',
  utmterm: 'utmTerm',
  src: 'src',
  fbclid: 'fbclid',
  fbc: 'fbc',
  fbp: 'fbp',
  ip: 'clientIp',
  clientip: 'clientIp',
  clientipaddress: 'clientIp',
  ipaddress: 'clientIp',
  customerip: 'clientIp',
  useragent: 'userAgent',
  clientuseragent: 'userAgent',
  ua: 'userAgent',
};

/** Contêineres em que vale a pena procurar. */
const CONTAINER_RE = /track|utm|param|metadata|origin|source|customer|client|buyer|cliente|comprador|lead/i;
/** Campos de URL de onde dá para tirar query string. */
const URL_KEY_RE = /url|link|referr?er|landing|page|href|query/i;

export function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined' || /^\{\{.*\}\}$/.test(s)) return null;
  return s.slice(0, 500);
}

function fromQuery(url: string, out: Tracking) {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url.includes('=') ? url : '';
  if (!q) return;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(q.split('#')[0]);
  } catch {
    return;
  }
  for (const [k, v] of params) {
    const field = ALIASES[normKey(k)];
    if (field && field !== 'clientIp' && field !== 'userAgent' && !out[field]) out[field] = clean(v);
  }
}

function scan(obj: Record<string, unknown>, out: Tracking) {
  for (const [k, v] of Object.entries(obj)) {
    const field = ALIASES[normKey(k)];
    if (field && !out[field]) {
      const c = clean(v);
      if (c) out[field] = c;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && URL_KEY_RE.test(k) && v.includes('=')) fromQuery(v, out);
  }
}

/**
 * Procura no nível de cima e em contêineres de rastreamento/cliente, até
 * dois níveis (cobre `data.trackProps`, `payload.tracking.utm` etc.).
 * Contêineres de rastreamento têm prioridade sobre o nível de cima.
 */
export function extractTracking(payload: unknown): Tracking {
  const out: Tracking = { ...EMPTY_TRACKING };
  if (!isObj(payload)) return out;

  const roots: Record<string, unknown>[] = [payload];
  for (const key of ['data', 'body', 'payload', 'order', 'sale', 'venda']) {
    const v = payload[key];
    if (isObj(v)) roots.push(v);
  }

  const containers: Record<string, unknown>[] = [];
  const walk = (o: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      if (isObj(v) && CONTAINER_RE.test(k)) {
        containers.push(v);
        if (depth < 2) walk(v, depth + 1);
      }
    }
  };
  for (const r of roots) walk(r, 1);

  // rastreamento primeiro (track*/utm*), depois cliente, depois o nível de cima
  const trackFirst = [...containers].sort((a, b) => score(b) - score(a));
  for (const c of trackFirst) scan(c, out);
  for (const r of roots) scan(r, out);
  return out;
}

function score(c: Record<string, unknown>): number {
  let n = 0;
  for (const k of Object.keys(c)) {
    const f = ALIASES[normKey(k)];
    if (f && f.startsWith('utm')) n += 2;
    else if (f) n += 1;
  }
  return n;
}

/**
 * Convenção da Utmify / templates de URL da Meta: utm_campaign = "Nome|ID".
 * Devolve o ID numérico da campanha, se houver.
 */
export function campaignIdFromUtm(utmCampaign: string | null): string | null {
  if (!utmCampaign) return null;
  const m = /(?:^|\|)\s*(\d{6,25})\s*$/.exec(utmCampaign);
  return m ? m[1] : null;
}

/** Nome da campanha sem o "|ID" do final. */
export function campaignNameFromUtm(utmCampaign: string | null): string | null {
  if (!utmCampaign) return null;
  return utmCampaign.replace(/\|\s*\d{6,25}\s*$/, '').trim() || null;
}

const META_SOURCES = new Set(['fb', 'facebook', 'ig', 'instagram', 'meta', 'metaads', 'facebookads', 'an', 'msg', 'messenger']);

/** Fonte de tráfego "humana" para agrupar. */
export function trafficSource(t: Pick<Tracking, 'utmSource' | 'fbclid'>): string {
  const s = t.utmSource?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  if (META_SOURCES.has(s) || (!s && t.fbclid)) return 'Meta';
  if (!s) return 'Direto';
  if (['google', 'googleads', 'adwords', 'gads', 'youtube'].includes(s)) return 'Google';
  if (['tiktok', 'tiktokads'].includes(s)) return 'TikTok';
  return t.utmSource!;
}
