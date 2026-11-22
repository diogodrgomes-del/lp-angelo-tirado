/**
 * Dinheiro é SEMPRE inteiro em centavos. Nada de float somando valores.
 * Conversões de texto para centavos são feitas por manipulação de string,
 * nunca por parseFloat * 100 (0.29 * 100 = 28.999999999999996).
 */

export type AmountUnit = 'cents' | 'decimal';

/** "123.45" | "123" | "-0.11" | "1e2"(rejeitado) → centavos. Ponto é o separador decimal. */
export function decimalStringToCents(input: string): number {
  const s = input.trim();
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Valor decimal inválido: "${input}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const int = m[2];
  const frac = (m[3] ?? '').padEnd(3, '0');
  let cents = Number(int) * 100 + Number(frac.slice(0, 2));
  // arredonda meio-para-cima pelo terceiro dígito
  if (Number(frac[2]) >= 5) cents += 1;
  return sign * cents;
}

/**
 * Valor vindo da API de uma plataforma. A unidade é declarada pelo provider,
 * nunca adivinhada: 1790 em "cents" é R$ 17,90; 17.9 em "decimal" é R$ 17,90.
 */
export function amountToCents(value: unknown, unit: AmountUnit): number {
  if (value === null || value === undefined || value === '') {
    throw new Error('Valor ausente');
  }
  if (unit === 'cents') {
    const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`Esperava centavos inteiros e veio "${String(value)}"`);
    }
    return n;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Valor inválido: ${value}`);
    return decimalStringToCents(numberToPlainString(value));
  }
  if (typeof value === 'string') return decimalStringToCents(value);
  throw new Error(`Valor inválido: ${String(value)}`);
}

function numberToPlainString(n: number): string {
  // toFixed(6) evita notação científica e preserva o necessário para arredondar
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Texto em formato brasileiro, como vem nas exportações:
 * "27,90" | "1.234,56" | "R$ 1.234,56" | "-0,11" | "R$ -2,11" | "1234.56" (ponto decimal).
 * Number("27,90") é NaN — por isso este parser existe.
 */
export function parseBRL(input: unknown): number {
  if (typeof input === 'number') return amountToCents(input, 'decimal');
  if (input === null || input === undefined) throw new Error('Valor ausente');
  let s = String(input).trim();
  if (!s) throw new Error('Valor ausente');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/R\$/gi, '').replace(/\s| /g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s)) throw new Error(`Valor inválido: "${String(input)}"`);

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0) {
    // vírgula presente: ela é o decimal, pontos são milhar
    if (lastDot > lastComma) throw new Error(`Valor ambíguo: "${String(input)}"`);
    normalized = s.replace(/\./g, '').replace(',', '.');
    if ((normalized.match(/,/g) ?? []).length) throw new Error(`Valor inválido: "${String(input)}"`);
  } else if (lastDot >= 0) {
    const dots = (s.match(/\./g) ?? []).length;
    const after = s.length - lastDot - 1;
    // "1.234" (um ponto, 3 dígitos depois) ou "1.234.567" → milhar; "17.90" → decimal
    if (dots > 1 || after === 3) normalized = s.replace(/\./g, '');
    else normalized = s;
  } else {
    normalized = s;
  }
  const cents = decimalStringToCents(normalized);
  return negative ? -cents : cents;
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatBRL(cents: number): string {
  return fmt.format(cents / 100);
}

export function formatPercent(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return 'N/A';
  return `${(ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return 'N/A';
  return ratio.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatInt(n: number): string {
  return n.toLocaleString('pt-BR');
}
