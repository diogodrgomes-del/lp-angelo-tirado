import { describe, expect, it } from 'vitest';
import { computeSummary, productKey, taxOf, type MetricSale } from '@/lib/metrics';
import { periodRange, parseLocalDateTime } from '@/lib/dates';

const at = (s: string) => parseLocalDateTime(s)!;
const base: MetricSale = {
  status: 'approved',
  paymentMethod: 'card',
  productKey: 'kiwify:p1',
  productName: 'Curso',
  source: 'Meta',
  grossCents: 10000,
  netCents: 9000,
  orderedAt: at('2026-03-10 10:00'),
  paidAt: at('2026-03-10 10:01'),
  refundedAt: null,
  updatedAt: at('2026-03-10 10:01'),
};
const sale = (o: Partial<MetricSale>): MetricSale => ({ ...base, ...o });

const now = at('2026-03-10 23:00');
const today = periodRange('hoje', now);
const params = { taxBps: 738, fixedCostPerSaleCents: 0, productCosts: new Map<string, number>() };

describe('métricas', () => {
  it('faturamento, ROAS, imposto, lucro e ROI', () => {
    const s = computeSummary(
      [sale({}), sale({ netCents: 4000 })],
      [{ date: '2026-03-10', spendCents: 5000 }],
      today,
      { ...params, fixedCostPerSaleCents: 100, productCosts: new Map([['kiwify:p1', 500]]) },
    );
    expect(s.netRevenueCents).toBe(13000);
    expect(s.approvedCount).toBe(2);
    expect(s.spendCents).toBe(5000);
    expect(s.roas).toBeCloseTo(2.6);
    expect(s.adTaxCents).toBe(369); // 5000 * 7,38%
    expect(s.productCostCents).toBe(1000);
    expect(s.fixedCostCents).toBe(200);
    expect(s.profitCents).toBe(13000 - 5000 - 369 - 1000 - 200);
    expect(s.roi).toBeCloseTo(s.profitCents / 5369);
    expect(s.avgTicketCents).toBe(6500);
  });

  it('sem gasto: ROAS e ROI são N/A, não infinito', () => {
    const s = computeSummary([sale({})], [], today, params);
    expect(s.roas).toBeNull();
    expect(s.roi).toBeNull();
  });

  it('faturamento conta pela data de PAGAMENTO (pix gerado dia 1, pago dia 10)', () => {
    const pix = sale({ paymentMethod: 'pix', orderedAt: at('2026-03-01 09:00'), paidAt: at('2026-03-10 09:00') });
    expect(computeSummary([pix], [], today, params).netRevenueCents).toBe(9000);
    const dia1 = periodRange('hoje', at('2026-03-01 23:00'));
    expect(computeSummary([pix], [], dia1, params).netRevenueCents).toBe(0);
  });

  it('pendentes contam pela data do PEDIDO', () => {
    const p = sale({ status: 'pending', paidAt: null, grossCents: 4700 });
    const s = computeSummary([p], [], today, params);
    expect(s.pendingCount).toBe(1);
    expect(s.pendingCents).toBe(4700);
    expect(s.netRevenueCents).toBe(0);
  });

  it('taxa de aprovação inclui pendentes no denominador', () => {
    const s = computeSummary(
      [
        sale({ paymentMethod: 'pix' }),
        sale({ paymentMethod: 'pix', status: 'pending', paidAt: null }),
        sale({ paymentMethod: 'pix', status: 'pending', paidAt: null }),
        sale({ paymentMethod: 'pix', status: 'canceled', paidAt: null }),
        sale({ paymentMethod: 'card' }),
        sale({ paymentMethod: 'card', status: 'refused', paidAt: null }),
        sale({ paymentMethod: 'card', status: 'refunded' }),
      ],
      [],
      today,
      params,
    );
    expect(s.approval.pix).toEqual({ approved: 1, total: 4, rate: 0.25 });
    expect(s.approval.card.rate).toBeCloseTo(2 / 3);
    expect(s.approval.boleto.rate).toBeNull();
  });

  it('líquido negativo reduz o faturamento (não vira ganho)', () => {
    const s = computeSummary([sale({ grossCents: 200, netCents: -11 })], [], today, params);
    expect(s.netRevenueCents).toBe(-11);
  });

  it('reembolso sai do faturamento e conta pela data do estorno', () => {
    const r = sale({ status: 'refunded', paidAt: at('2026-03-01 10:00'), refundedAt: at('2026-03-10 12:00') });
    const s = computeSummary([r], [], today, params);
    expect(s.netRevenueCents).toBe(0);
    expect(s.refundedCount).toBe(1);
    expect(s.refundedCents).toBe(9000);
  });

  it('chargeback = contestações ÷ (aprovadas + contestações)', () => {
    const s = computeSummary([sale({}), sale({}), sale({}), sale({ status: 'chargeback' })], [], today, params);
    expect(s.chargebackRate).toBeCloseTo(0.25);
  });

  it('gasto fora do período não entra', () => {
    const s = computeSummary([], [{ date: '2026-03-09', spendCents: 999 }, { date: '2026-03-10', spendCents: 1 }], today, params);
    expect(s.spendCents).toBe(1);
  });

  it('série diária e agrupamentos', () => {
    const r7 = periodRange('7d', now);
    const s = computeSummary(
      [sale({}), sale({ source: 'Direto', productKey: 'kiwify:p2', productName: 'Outro', netCents: 100, paidAt: at('2026-03-08 10:00') })],
      [{ date: '2026-03-10', spendCents: 1000 }],
      r7,
      params,
    );
    expect(s.daily).toHaveLength(7);
    const d10 = s.daily.find((d) => d.day === '2026-03-10')!;
    expect(d10).toEqual({ day: '2026-03-10', netCents: 9000, spendCents: 1000, profitCents: 9000 - 1000 - taxOf(1000, 738) });
    expect(s.bySource.map((b) => b.source)).toEqual(['Meta', 'Direto']);
    expect(s.byProduct.map((b) => b.name)).toEqual(['Curso', 'Outro']);
  });

  it('período Máximo não gera série de 10 anos vazia', () => {
    const s = computeSummary([sale({})], [], periodRange('max', now), params);
    expect(s.daily.length).toBe(1);
  });

  it('chave do produto', () => {
    expect(productKey('kiwify', 'p1', 'X')).toBe('kiwify:p1');
    expect(productKey('wiapy', null, ' Mapas ')).toBe('wiapy:name:mapas');
  });
});
