/**
 * Datas: o banco guarda instantes em UTC; "dia" é sempre o dia de Brasília.
 * Brasil não tem horário de verão desde 2019, então o offset é fixo -03:00.
 * Uma venda das 21h de Brasília é 00h UTC do dia seguinte — ler data sem fuso
 * como UTC joga essa venda no dia errado.
 */

export const BR_OFFSET_MINUTES = -180;
const OFFSET_MS = BR_OFFSET_MINUTES * 60_000;

/** "YYYY-MM-DD" do instante, no fuso de Brasília. */
export function dayKey(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Meia-noite de Brasília do dia "YYYY-MM-DD", como instante UTC. */
export function startOfDay(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error(`Dia inválido: ${key}`);
  return new Date(Date.parse(`${key}T00:00:00.000Z`) - OFFSET_MS);
}

export function addDays(key: string, n: number): string {
  const t = Date.parse(`${key}T00:00:00.000Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) out.push(k);
  return out;
}

/**
 * Data/hora SEM fuso (como vem em exportações e em várias APIs brasileiras),
 * interpretada como horário de Brasília.
 * Aceita "2026-01-10 14:22", "2026-01-10T14:22:05", "10/01/2026 14:22:05", "10/01/2026".
 * Se o texto TIVER fuso (Z ou ±hh:mm), ele é respeitado.
 */
export function parseLocalDateTime(input: unknown): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    // epoch em segundos ou ms
    const ms = input < 1e12 ? input * 1000 : input;
    return new Date(ms);
  }
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{10,13}$/.test(s)) return parseLocalDateTime(Number(s));

  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s);
  if (hasZone) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let y: number, mo: number, d: number, h = 0, mi = 0, se = 0;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(s);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4]) { h = Number(m[4]); mi = Number(m[5]); se = Number(m[6] ?? 0); }
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4]) { h = Number(m[4]); mi = Number(m[5]); se = Number(m[6] ?? 0); }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, se) - OFFSET_MS;
  const out = new Date(utc);
  // rejeita 31/02 etc.
  if (new Date(utc + OFFSET_MS).getUTCDate() !== d) return null;
  return out;
}

export const PERIODS = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7d', label: 'Últimos 7 dias' },
  { id: '14d', label: 'Últimos 14 dias' },
  { id: '30d', label: 'Últimos 30 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes_passado', label: 'Mês passado' },
  { id: 'max', label: 'Máximo' },
] as const;
export type PeriodId = (typeof PERIODS)[number]['id'];

export interface DateRange {
  /** primeiro dia, inclusive */
  fromDay: string;
  /** último dia, inclusive */
  toDay: string;
  /** instante inicial (inclusive) */
  from: Date;
  /** instante final (exclusivo) */
  to: Date;
}

export const MAX_START_DAY = '2015-01-01';

export function periodRange(period: string, now: Date = new Date()): DateRange {
  const today = dayKey(now);
  let fromDay = today;
  let toDay = today;
  switch (period) {
    case 'ontem': fromDay = toDay = addDays(today, -1); break;
    case '7d': fromDay = addDays(today, -6); break;
    case '14d': fromDay = addDays(today, -13); break;
    case '30d': fromDay = addDays(today, -29); break;
    case 'mes': fromDay = `${today.slice(0, 7)}-01`; break;
    case 'mes_passado': {
      const firstThis = `${today.slice(0, 7)}-01`;
      toDay = addDays(firstThis, -1);
      fromDay = `${toDay.slice(0, 7)}-01`;
      break;
    }
    case 'max': fromDay = MAX_START_DAY; break;
    default: break; // hoje
  }
  return { fromDay, toDay, from: startOfDay(fromDay), to: startOfDay(addDays(toDay, 1)) };
}

const dtFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
export function formatDateTime(d: Date | null | undefined): string {
  return d ? dtFmt.format(d).replace(',', '') : '—';
}
export function formatDayKey(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}
