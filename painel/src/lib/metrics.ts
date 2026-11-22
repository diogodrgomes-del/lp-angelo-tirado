import { daysBetween, dayKey, type DateRange } from './dates';
import type { PaymentMethod, SaleStatus } from './providers/types';

/**
 * Cálculo das métricas — função pura, sem banco, coberta por testes.
 *
 * Decisões que explicam divergência com outros painéis (manter todas):
 * 1. Faturamento conta pela data de PAGAMENTO. Pix gerado dia 1 e pago dia 5
 *    é receita do dia 5. Pendentes contam pela data do PEDIDO.
 * 2. Taxa de aprovação inclui pendentes no denominador; senão pix e boleto
 *    aparecem com aprovação perto de 100%.
 * 3. Tudo em centavos inteiros.
 * 4. Líquido preserva o sinal.
 */

export interface MetricSale {
  status: SaleStatus;
  paymentMethod: PaymentMethod;
  productKey: string;
  productName: string;
  source: string;
  grossCents: number;
  netCents: number;
  orderedAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  updatedAt: Date;
}

export interface SpendRow {
  date: string; // YYYY-MM-DD
  spendCents: number;
}

export interface MetricParams {
  /** imposto sobre anúncios em pontos-base: 738 = 7,38% */
  taxBps: number;
  fixedCostPerSaleCents: number;
  /** custo unitário por productKey */
  productCosts: Map<string, number>;
}

export interface MethodRate {
  approved: number;
  total: number;
  rate: number | null;
}

export interface Summary {
  netRevenueCents: number;
  approvedCount: number;
  grossRevenueCents: number;
  spendCents: number;
  roas: number | null;
  adTaxCents: number;
  productCostCents: number;
  fixedCostCents: number;
  profitCents: number;
  roi: number | null;
  pendingCents: number;
  pendingCount: number;
  approval: Record<'card' | 'pix' | 'boleto', MethodRate>;
  refundedCents: number;
  refundedCount: number;
  chargebackCount: number;
  chargebackRate: number | null;
  avgTicketCents: number;
  byProduct: { key: string; name: string; count: number; netCents: number }[];
  bySource: { source: string; count: number; netCents: number }[];
  daily: { day: string; netCents: number; spendCents: number; profitCents: number }[];
}

const inRange = (d: Date | null, r: DateRange) => !!d && d >= r.from && d < r.to;
const div = (a: number, b: number) => (b === 0 ? null : a / b);
/** arredondamento de centavos sem viés para valores positivos */
export const taxOf = (spendCents: number, taxBps: number) => Math.round((spendCents * taxBps) / 10_000);

/** Vendas que entram no faturamento: aprovadas, pagas dentro do período. */
function isRevenue(s: MetricSale, r: DateRange) {
  return s.status === 'approved' && inRange(s.paidAt, r);
}

export function computeSummary(
  sales: MetricSale[],
  spend: SpendRow[],
  range: DateRange,
  params: MetricParams,
): Summary {
  const revenue = sales.filter((s) => isRevenue(s, range));
  const netRevenueCents = sum(revenue, (s) => s.netCents);
  const grossRevenueCents = sum(revenue, (s) => s.grossCents);
  const approvedCount = revenue.length;

  const spendInRange = spend.filter((r) => r.date >= range.fromDay && r.date <= range.toDay);
  const spendCents = sum(spendInRange, (r) => r.spendCents);
  const adTaxCents = taxOf(spendCents, params.taxBps);
  const unitCost = (s: MetricSale) => params.productCosts.get(s.productKey) ?? 0;
  const productCostCents = sum(revenue, unitCost);
  const fixedCostCents = approvedCount * params.fixedCostPerSaleCents;
  const profitCents = netRevenueCents - spendCents - adTaxCents - productCostCents - fixedCostCents;

  // pendentes: pela data do PEDIDO
  const pending = sales.filter((s) => s.status === 'pending' && inRange(s.orderedAt, range));

  // aprovação: coorte de pedidos criados no período, por método
  const approval = {
    card: { approved: 0, total: 0, rate: null as number | null },
    pix: { approved: 0, total: 0, rate: null as number | null },
    boleto: { approved: 0, total: 0, rate: null as number | null },
  };
  for (const s of sales) {
    if (!inRange(s.orderedAt, range)) continue;
    if (s.paymentMethod === 'other') continue;
    const m = approval[s.paymentMethod];
    m.total += 1;
    // reembolso e chargeback FORAM aprovados — a aprovação aconteceu
    if (s.status === 'approved' || s.status === 'refunded' || s.status === 'chargeback') m.approved += 1;
  }
  for (const m of Object.values(approval)) m.rate = div(m.approved, m.total);

  // reembolsos: pela data em que saíram
  const refunded = sales.filter((s) => s.status === 'refunded' && inRange(s.refundedAt ?? s.updatedAt, range));

  // chargeback: contestações ÷ (aprovadas + contestações), coorte por pagamento
  const cb = sales.filter((s) => s.status === 'chargeback' && inRange(s.paidAt, range));
  const chargebackRate = div(cb.length, approvedCount + cb.length);

  const byProductMap = new Map<string, { key: string; name: string; count: number; netCents: number }>();
  const bySourceMap = new Map<string, { source: string; count: number; netCents: number }>();
  for (const s of revenue) {
    const p = byProductMap.get(s.productKey) ?? { key: s.productKey, name: s.productName, count: 0, netCents: 0 };
    p.count += 1;
    p.netCents += s.netCents;
    byProductMap.set(s.productKey, p);
    const f = bySourceMap.get(s.source) ?? { source: s.source, count: 0, netCents: 0 };
    f.count += 1;
    f.netCents += s.netCents;
    bySourceMap.set(s.source, f);
  }

  // série diária (limitada ao intervalo com dados quando o período é "Máximo")
  let firstDay = range.fromDay;
  const lastDay = range.toDay;
  if (daysBetweenCount(firstDay, lastDay) > 400) {
    const candidates = [...revenue.map((s) => dayKey(s.paidAt!)), ...spendInRange.map((r) => r.date)].sort();
    firstDay = candidates[0] ?? lastDay;
  }
  const daily = new Map<string, { day: string; netCents: number; spendCents: number; profitCents: number }>();
  for (const d of daysBetween(firstDay, lastDay)) daily.set(d, { day: d, netCents: 0, spendCents: 0, profitCents: 0 });
  for (const s of revenue) {
    const row = daily.get(dayKey(s.paidAt!));
    if (row) {
      row.netCents += s.netCents;
      row.profitCents += s.netCents - unitCost(s) - params.fixedCostPerSaleCents;
    }
  }
  for (const r of spendInRange) {
    const row = daily.get(r.date);
    if (row) row.spendCents += r.spendCents;
  }
  for (const row of daily.values()) row.profitCents -= row.spendCents + taxOf(row.spendCents, params.taxBps);

  return {
    netRevenueCents,
    approvedCount,
    grossRevenueCents,
    spendCents,
    roas: div(netRevenueCents, spendCents),
    adTaxCents,
    productCostCents,
    fixedCostCents,
    profitCents,
    roi: div(profitCents, spendCents + adTaxCents),
    pendingCents: sum(pending, (s) => s.grossCents),
    pendingCount: pending.length,
    approval,
    refundedCents: sum(refunded, (s) => s.netCents),
    refundedCount: refunded.length,
    chargebackCount: cb.length,
    chargebackRate,
    avgTicketCents: approvedCount ? Math.round(netRevenueCents / approvedCount) : 0,
    byProduct: [...byProductMap.values()].sort((a, b) => b.netCents - a.netCents),
    bySource: [...bySourceMap.values()].sort((a, b) => b.netCents - a.netCents),
    daily: [...daily.values()],
  };
}

function daysBetweenCount(a: string, b: string) {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

function sum<T>(list: T[], f: (x: T) => number): number {
  let t = 0;
  for (const x of list) t += f(x);
  return t;
}

/** Chave do produto para custo e filtro. */
export function productKey(platform: string, productId: string | null, productName: string): string {
  return productId ? `${platform}:${productId}` : `${platform}:name:${productName.trim().toLowerCase()}`;
}
