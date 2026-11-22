import { parseBRL } from './money';
import { parseLocalDateTime } from './dates';
import { EMPTY_TRACKING } from './tracking';
import type { NormalizedSale, PaymentMethod, SaleStatus } from './providers/types';

/**
 * Importação do histórico a partir da exportação (CSV/XLSX) da plataforma.
 *
 * - Usa o MESMO id que o webhook usa: importação é idempotente e convive com ele.
 * - "27,90" e "1.234,56" são tratados explicitamente (Number("27,90") é NaN).
 * - Data sem fuso = horário de Brasília. Lida como UTC, venda das 21h cai no dia seguinte.
 * - NÃO inventa atribuição: exportação de checkout não traz UTM. Melhor
 *   faturamento verdadeiro sem origem do que origem inventada.
 */

export type Row = Record<string, unknown>;

export function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Colunas aceitas para cada campo, por nome normalizado. Ordem = prioridade. */
export const COLUMNS: Record<string, string[]> = {
  id: ['id da venda', 'id do pedido', 'order id', 'pedido', 'id pedido', 'codigo da venda', 'codigo', 'id transacao', 'transacao', 'id'],
  status: ['status', 'status da venda', 'status do pedido', 'situacao'],
  method: ['metodo de pagamento', 'forma de pagamento', 'pagamento', 'payment method', 'metodo'],
  product: ['produto', 'nome do produto', 'product', 'oferta'],
  productId: ['id do produto', 'product id', 'codigo do produto'],
  customer: ['cliente', 'nome do cliente', 'comprador', 'nome', 'customer'],
  email: ['email', 'e mail', 'email do cliente', 'e mail do cliente'],
  phone: ['telefone', 'celular', 'whatsapp', 'phone'],
  gross: ['valor total', 'valor cobrado', 'valor bruto', 'total', 'valor da venda', 'preco', 'valor'],
  net: ['valor liquido', 'liquido', 'sua comissao', 'minha comissao', 'comissao', 'valor recebido', 'net'],
  ordered: ['data de criacao', 'data do pedido', 'criado em', 'data da venda', 'data', 'created at'],
  paid: ['data de aprovacao', 'data do pagamento', 'data de pagamento', 'aprovado em', 'pago em', 'approved date'],
  refunded: ['data do reembolso', 'reembolsado em', 'data de reembolso'],
};

const REQUIRED = ['id', 'status', 'gross', 'net', 'ordered'] as const;

export function resolveColumns(headers: string[]): { map: Record<string, string>; missing: string[] } {
  const byNorm = new Map(headers.map((h) => [normHeader(h), h]));
  const map: Record<string, string> = {};
  for (const [field, candidates] of Object.entries(COLUMNS)) {
    for (const c of candidates) {
      const h = byNorm.get(c);
      if (h && !Object.values(map).includes(h)) {
        map[field] = h;
        break;
      }
    }
  }
  return { map, missing: REQUIRED.filter((f) => !map[f]) };
}

const STATUS: [RegExp, SaleStatus][] = [
  [/chargeback|contestad|disputa/, 'chargeback'],
  [/reembols|refund|estorn|devolvid/, 'refunded'],
  [/recusad|refused|negad|declined|falhou/, 'refused'],
  [/cancelad|canceled|cancelled|expirad|expired/, 'canceled'],
  [/aguardando|pendente|pending|waiting|gerado|emitido|processando/, 'pending'],
  [/aprovad|approved|pag[oa]|paid|conclu|completed|complete/, 'approved'],
];

export function parseStatus(v: unknown): SaleStatus | null {
  const s = normHeader(String(v ?? ''));
  for (const [re, st] of STATUS) if (re.test(s)) return st;
  return null;
}

export function parseMethod(v: unknown): PaymentMethod {
  const s = normHeader(String(v ?? ''));
  if (s.includes('pix')) return 'pix';
  if (s.includes('boleto') || s.includes('billet')) return 'boleto';
  if (s.includes('cart') || s.includes('card') || s.includes('credit') || s.includes('credito')) return 'card';
  return 'other';
}

export interface ImportResult {
  sales: NormalizedSale[];
  errors: { line: number; error: string }[];
}

export function rowsToSales(rows: Row[], map: Record<string, string>): ImportResult {
  const sales: NormalizedSale[] = [];
  const errors: { line: number; error: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2; // linha 1 é o cabeçalho
    const get = (f: string) => (map[f] ? row[map[f]] : undefined);
    try {
      const externalId = String(get('id') ?? '').trim();
      if (!externalId) throw new Error('sem id');
      if (seen.has(externalId)) throw new Error(`id repetido na planilha: ${externalId}`);
      const status = parseStatus(get('status'));
      if (!status) throw new Error(`status não reconhecido: "${String(get('status') ?? '')}"`);
      const orderedAt = parseLocalDateTime(get('ordered'));
      if (!orderedAt) throw new Error(`data inválida: "${String(get('ordered') ?? '')}"`);
      let paidAt = parseLocalDateTime(get('paid'));
      if (!paidAt && status === 'approved') paidAt = orderedAt; // sem coluna de aprovação: melhor aproximação
      if (status === 'pending' || status === 'refused' || status === 'canceled') paidAt = null;
      seen.add(externalId);
      sales.push({
        externalId,
        status,
        paymentMethod: parseMethod(get('method')),
        productId: get('productId') ? String(get('productId')).trim() : null,
        productName: String(get('product') ?? '').trim() || 'Produto sem nome',
        customerName: get('customer') ? String(get('customer')).trim() : null,
        customerEmail: get('email') ? String(get('email')).trim().toLowerCase() : null,
        customerPhone: get('phone') ? String(get('phone')).trim() : null,
        grossCents: parseBRL(get('gross')),
        netCents: parseBRL(get('net')),
        orderedAt,
        paidAt,
        refundedAt: status === 'refunded' || status === 'chargeback' ? parseLocalDateTime(get('refunded')) : null,
        tracking: { ...EMPTY_TRACKING }, // sem UTM: não inventar atribuição
      });
    } catch (e) {
      errors.push({ line, error: (e as Error).message });
    }
  });
  return { sales, errors };
}

/** CSV com aspas, vírgula ou ponto-e-vírgula (detectado pelo cabeçalho). */
export function parseCsv(text: string): Row[] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      rec.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      rec.push(field);
      records.push(rec);
      rec = [];
      field = '';
    } else field += c;
  }
  if (field || rec.length) {
    rec.push(field);
    records.push(rec);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  const [header, ...body] = nonEmpty;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** XLSX → linhas. Datas do Excel viram texto local "YYYY-MM-DD HH:mm:ss". */
export async function parseXlsx(buf: ArrayBuffer): Promise<Row[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: Row[] = [];
  let header: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const values = (row.values as unknown[]).slice(1).map(cellValue);
    if (n === 1 || header.length === 0) {
      header = values.map((v) => String(v ?? '').trim());
      return;
    }
    rows.push(Object.fromEntries(header.map((h, i) => [h, values[i] ?? ''])));
  });
  return rows;
}

function cellValue(v: unknown): unknown {
  if (v instanceof Date) {
    // o Excel guarda o horário "de parede"; o exceljs o devolve como se fosse UTC
    return v.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (v && typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.result !== undefined) return cellValue(o.result);
    if (o.text !== undefined) return o.text;
  }
  return v;
}
