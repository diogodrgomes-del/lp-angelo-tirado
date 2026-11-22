import type { Sale } from '@prisma/client';
import { prisma } from './db';
import { periodRange, type DateRange } from './dates';
import type { Filters } from './filters';
import { computeSummary, productKey, type MetricSale, type SpendRow } from './metrics';
import { campaignIdFromUtm, campaignNameFromUtm, trafficSource } from './tracking';
import { getCalcParams } from './settings';
import { enabledPlatformIds, ALL_PROVIDERS } from './providers';
import type { PaymentMethod, SaleStatus } from './providers/types';

/** Vendas que tocam o período por qualquer uma das datas relevantes. */
async function salesTouching(range: DateRange): Promise<Sale[]> {
  const r = { gte: range.from, lt: range.to };
  return prisma.sale.findMany({
    where: { OR: [{ paidAt: r }, { orderedAt: r }, { refundedAt: r }, { status: 'refunded', updatedAt: r }] },
    orderBy: { orderedAt: 'desc' },
  });
}

async function campaignAccountMap(): Promise<Map<string, { accountId: string; name: string }>> {
  const list = await prisma.campaign.findMany({ select: { id: true, adAccountId: true, name: true } });
  return new Map(list.map((c) => [c.id, { accountId: c.adAccountId, name: c.name }]));
}

function matchesCampaign(sale: Sale, wanted: string): boolean {
  if (!wanted) return true;
  return sale.utmCampaign === wanted;
}

export function applySaleFilters(
  sales: Sale[],
  f: Filters,
  campaigns: Map<string, { accountId: string; name: string }>,
): Sale[] {
  return sales.filter((s) => {
    if (f.platform && s.platform !== f.platform) return false;
    if (f.method && s.paymentMethod !== f.method) return false;
    if (f.product && productKey(s.platform, s.productId, s.productName) !== f.product) return false;
    if (f.source && trafficSource(s) !== f.source) return false;
    if (f.medium && s.utmMedium !== f.medium) return false;
    if (!matchesCampaign(s, f.campaign)) return false;
    if (f.account) {
      const c = s.campaignId ? campaigns.get(s.campaignId) : undefined;
      if (!c || c.accountId !== f.account) return false;
    }
    return true;
  });
}

export function toMetricSale(s: Sale): MetricSale {
  return {
    status: s.status as SaleStatus,
    paymentMethod: s.paymentMethod as PaymentMethod,
    productKey: productKey(s.platform, s.productId, s.productName),
    productName: s.productName,
    source: trafficSource(s),
    grossCents: s.grossCents,
    netCents: s.netCents,
    orderedAt: s.orderedAt,
    paidAt: s.paidAt,
    refundedAt: s.refundedAt,
    updatedAt: s.updatedAt,
  };
}

/**
 * Gasto diário das contas ATIVAS.
 * - Fonte de tráfego diferente de Meta → gasto zero (o gasto é todo da Meta).
 * - utm_campaign filtrado → só o gasto da campanha correspondente (pelo id "Nome|ID" ou pelo nome).
 * - Produto e método de pagamento não filtram o gasto: a Meta não sabe disso.
 */
async function spendRows(range: DateRange, f: Filters): Promise<SpendRow[]> {
  if (f.source && f.source !== 'Meta') return [];
  const campaignWhere: Record<string, unknown> = { adAccount: { active: true } };
  if (f.account) campaignWhere.adAccountId = f.account;
  if (f.campaign) {
    const id = campaignIdFromUtm(f.campaign);
    campaignWhere.OR = id ? [{ id }] : [{ name: campaignNameFromUtm(f.campaign) ?? f.campaign }];
  }
  const rows = await prisma.campaignDaily.groupBy({
    by: ['date'],
    where: { date: { gte: range.fromDay, lte: range.toDay }, campaign: campaignWhere },
    _sum: { spendCents: true },
  });
  return rows.map((r) => ({ date: r.date, spendCents: r._sum.spendCents ?? 0 }));
}

async function productCostMap(): Promise<Map<string, number>> {
  const list = await prisma.productCost.findMany();
  return new Map(list.map((p) => [p.key, p.costCents]));
}

export async function loadSummary(f: Filters, now = new Date()) {
  const range = periodRange(f.period, now);
  const [sales, campaigns, spend, costs, params] = await Promise.all([
    salesTouching(range),
    campaignAccountMap(),
    spendRows(range, f),
    productCostMap(),
    getCalcParams(),
  ]);
  const filtered = applySaleFilters(sales, f, campaigns).map(toMetricSale);
  const summary = computeSummary(filtered, spend, range, { ...params, productCosts: costs });
  return { range, summary, params };
}

export async function loadFilterOptions() {
  const [accounts, sales] = await Promise.all([
    prisma.adAccount.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.sale.findMany({
      select: {
        platform: true,
        productId: true,
        productName: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        fbclid: true,
      },
      orderBy: { orderedAt: 'desc' },
      take: 5000,
    }),
  ]);
  const sources = new Set<string>(['Meta']);
  const mediums = new Set<string>();
  const campaigns = new Set<string>();
  const products = new Map<string, string>();
  for (const s of sales) {
    sources.add(trafficSource(s));
    if (s.utmMedium) mediums.add(s.utmMedium);
    if (s.utmCampaign) campaigns.add(s.utmCampaign);
    products.set(productKey(s.platform, s.productId, s.productName), s.productName);
  }
  return {
    accounts: accounts.map((a) => ({ value: a.id, label: a.name })),
    sources: [...sources].sort().map((s) => ({ value: s, label: s })),
    platforms: enabledPlatformIds().map((id) => ({ value: id, label: ALL_PROVIDERS[id].label })),
    products: [...products.entries()].map(([value, label]) => ({ value, label })),
    mediums: [...mediums].sort().map((m) => ({ value: m, label: m })),
    campaigns: [...campaigns].sort().map((c) => ({ value: c, label: campaignNameFromUtm(c) ?? c })),
  };
}

export async function loadSales(f: Filters, now = new Date()) {
  const range = periodRange(f.period, now);
  const r = { gte: range.from, lt: range.to };
  const [sales, campaigns] = await Promise.all([
    prisma.sale.findMany({
      where: { OR: [{ paidAt: r }, { orderedAt: r }] },
      orderBy: { orderedAt: 'desc' },
      take: 2000,
    }),
    campaignAccountMap(),
  ]);
  let list = applySaleFilters(sales, f, campaigns);
  if (f.status) list = list.filter((s) => s.status === f.status);
  return {
    range,
    sales: list.map((s) => ({
      ...s,
      source: trafficSource(s),
      campaignName: (s.campaignId && campaigns.get(s.campaignId)?.name) || campaignNameFromUtm(s.utmCampaign),
    })),
  };
}

export async function loadCampaigns(f: Filters, now = new Date()) {
  const range = periodRange(f.period, now);
  const where: Record<string, unknown> = { adAccount: { active: true } };
  if (f.account) where.adAccountId = f.account;
  const [campaigns, daily, sales] = await Promise.all([
    prisma.campaign.findMany({ where, include: { adAccount: { select: { name: true } } } }),
    prisma.campaignDaily.groupBy({
      by: ['campaignId'],
      where: { date: { gte: range.fromDay, lte: range.toDay }, campaign: where },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
    prisma.sale.findMany({ where: { status: 'approved', paidAt: { gte: range.from, lt: range.to } } }),
  ]);
  const byId = new Map(daily.map((d) => [d.campaignId, d._sum]));
  const nameToId = new Map(campaigns.map((c) => [c.name.trim().toLowerCase(), c.id]));

  const salesBy = new Map<string, { count: number; net: number }>();
  let unattributed = { count: 0, net: 0 };
  for (const s of sales) {
    if (f.platform && s.platform !== f.platform) continue;
    if (f.product && productKey(s.platform, s.productId, s.productName) !== f.product) continue;
    if (f.method && s.paymentMethod !== f.method) continue;
    const id =
      s.campaignId ?? (s.utmCampaign ? nameToId.get((campaignNameFromUtm(s.utmCampaign) ?? '').toLowerCase()) : undefined);
    if (id && byIdOrCampaign(id, campaigns)) {
      const cur = salesBy.get(id) ?? { count: 0, net: 0 };
      cur.count++;
      cur.net += s.netCents;
      salesBy.set(id, cur);
    } else {
      unattributed = { count: unattributed.count + 1, net: unattributed.net + s.netCents };
    }
  }

  const rows = campaigns
    .map((c) => {
      const d = byId.get(c.id);
      const sv = salesBy.get(c.id) ?? { count: 0, net: 0 };
      const spend = d?.spendCents ?? 0;
      return {
        id: c.id,
        name: c.name,
        account: c.adAccount.name,
        status: c.status,
        impressions: d?.impressions ?? 0,
        clicks: d?.clicks ?? 0,
        spendCents: spend,
        sales: sv.count,
        revenueCents: sv.net,
        cpaCents: sv.count ? Math.round(spend / sv.count) : null,
        roas: spend ? sv.net / spend : null,
      };
    })
    .filter((r) => r.spendCents > 0 || r.sales > 0 || r.impressions > 0)
    .sort((a, b) => b.spendCents - a.spendCents || b.revenueCents - a.revenueCents);

  return { range, rows, unattributed };
}

function byIdOrCampaign(id: string, campaigns: { id: string }[]) {
  return campaigns.some((c) => c.id === id);
}
