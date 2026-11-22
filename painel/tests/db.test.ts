/**
 * Testes contra um Postgres de verdade. Rodam só com TEST_DATABASE_URL
 * (banco descartável, com as migrações aplicadas):
 *   TEST_DATABASE_URL=postgresql://... npx vitest run tests/db.test.ts
 */
import { createHmac, randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const URL_ = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL_)('banco: webhook, reprocesso, importação, contas', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let m: any;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.CHECKOUT_PLATFORMS = 'kiwify,wiapy';
    m = {
      ...(await import('@/lib/db')),
      ...(await import('@/lib/webhook')),
      ...(await import('@/lib/sales')),
      ...(await import('@/lib/crypto')),
      ...(await import('@/lib/queries')),
      ...(await import('@/lib/filters')),
      ...(await import('@/lib/importer')),
    };
  });

  beforeEach(async () => {
    const p = m.prisma;
    await p.$executeRawUnsafe(
      'TRUNCATE "Sale","WebhookEvent","Integration","AdAccount","Campaign","CampaignDaily","ProductCost","Setting" CASCADE',
    );
    await p.integration.createMany({ data: [{ id: 'kiwify' }, { id: 'wiapy' }, { id: 'meta_ads' }] });
    delete process.env.WIAPY_AMOUNT_UNIT;
  });

  const kiwifyBody = (o: Record<string, unknown> = {}) =>
    JSON.stringify({
      order_id: 'ord-1',
      order_status: 'waiting_payment',
      webhook_event_type: 'pix_created',
      payment_method: 'pix',
      created_at: '2026-03-10 10:00',
      approved_date: null,
      Product: { product_id: 'p1', product_name: 'Curso' },
      Customer: { full_name: 'Ana', email: 'ana@x.com' },
      Commissions: { charge_amount: 9700, my_commission: 8900 },
      TrackingParameters: { utm_source: 'fb', utm_campaign: 'Camp|120000000000001' },
      ...o,
    });
  const req = (platform: string, body: string, qs = '') => ({
    rawBody: body,
    headers: new Headers({ 'content-type': 'application/json' }),
    url: new URL(`https://painel.test/api/webhooks/${platform}${qs}`),
  });

  it('plataforma não habilitada: 404 e nada gravado', async () => {
    process.env.CHECKOUT_PLATFORMS = 'kiwify';
    const r = await m.receiveWebhook('wiapy', req('wiapy', '{}'));
    expect(r.status).toBe(404);
    expect(await m.prisma.webhookEvent.count()).toBe(0);
    process.env.CHECKOUT_PLATFORMS = 'kiwify,wiapy';
  });

  it('pendente → aprovado: uma venda só, pago na data da aprovação, sem rebaixar com evento atrasado', async () => {
    await m.receiveWebhook('kiwify', req('kiwify', kiwifyBody()));
    const approved = kiwifyBody({ order_status: 'paid', webhook_event_type: 'order_approved', approved_date: '2026-03-12 21:30' });
    const r = await m.receiveWebhook('kiwify', req('kiwify', approved));
    expect(r.approvedSaleIds).toHaveLength(1);
    // evento "pendente" atrasado
    await m.receiveWebhook('kiwify', req('kiwify', kiwifyBody()));
    const sales = await m.prisma.sale.findMany();
    expect(sales).toHaveLength(1);
    expect(sales[0].status).toBe('approved');
    expect(sales[0].paidAt.toISOString()).toBe('2026-03-13T00:30:00.000Z');
    expect(sales[0].campaignId).toBe('120000000000001');
    expect(await m.prisma.webhookEvent.count()).toBe(3);
  });

  it('com segredo: assinatura errada é recusada; certa é aceita', async () => {
    await m.prisma.integration.update({ where: { id: 'kiwify' }, data: { webhookSecret: m.encrypt('tok') } });
    const body = kiwifyBody();
    const bad = await m.receiveWebhook('kiwify', req('kiwify', body, '?signature=abc'));
    expect(bad.status).toBe(401);
    expect(await m.prisma.webhookEvent.count()).toBe(0);
    const sig = createHmac('sha1', 'tok').update(body).digest('hex');
    const ok = await m.receiveWebhook('kiwify', req('kiwify', body, `?signature=${sig}`));
    expect(ok.status).toBe(200);
    expect(await m.prisma.sale.count()).toBe(1);
  });

  it('mapeamento faltando: payload cru fica salvo e o reprocesso recupera a venda', async () => {
    const body = JSON.stringify({
      event: 'payment.paid',
      payment: { id: 'P1', status: 'paid', method: 'pix', amount: 11690, net_amount: 10500, dt_created: '2026-03-01 10:00:00', dt_update: '2026-03-01 10:05:00' },
      checkout: { id: 'C1', amount: 9700 },
    });
    const r = await m.receiveWebhook('wiapy', req('wiapy', body));
    expect(r.status).toBe(200);
    expect(await m.prisma.sale.count()).toBe(0);
    const ev = await m.prisma.webhookEvent.findFirst();
    expect(ev.status).toBe('error');
    expect(ev.rawBody).toBe(body);

    process.env.WIAPY_AMOUNT_UNIT = 'cents';
    const counts = await m.reprocessAll('wiapy');
    expect(counts.processed).toBe(1);
    const sale = await m.prisma.sale.findFirst();
    expect(sale.grossCents).toBe(11690);
  });

  it('importação convive com o webhook e é idempotente', async () => {
    await m.receiveWebhook('kiwify', req('kiwify', kiwifyBody({ order_status: 'paid', approved_date: '2026-03-10 10:01' })));
    const rows = m.parseCsv(
      'ID;Status;Produto;Valor total;Valor líquido;Data de criação;Data de aprovação\n' +
        'ord-1;Reembolsada;Curso;97,00;89,00;10/03/2026 10:00;10/03/2026 10:01\n' +
        'ord-2;Aprovada;Curso;97,00;89,00;09/03/2026 10:00;09/03/2026 10:01\n',
    );
    const { map } = m.resolveColumns(Object.keys(rows[0]));
    const { sales } = m.rowsToSales(rows, map);
    for (const s of sales) await m.upsertSale('kiwify', s, 'import');
    for (const s of sales) await m.upsertSale('kiwify', s, 'import'); // de novo
    const all = await m.prisma.sale.findMany({ orderBy: { externalId: 'asc' } });
    expect(all).toHaveLength(2);
    expect(all[0].status).toBe('approved'); // webhook manda
    expect(all[0].origin).toBe('webhook');
    expect(all[1].origin).toBe('import');
    expect(all[1].utmSource).toBeNull();
  });

  it('resumo usa só contas ativas no gasto', async () => {
    const p = m.prisma;
    await p.adAccount.createMany({
      data: [
        { id: 'act_1', name: 'Produto', active: true },
        { id: 'act_2', name: 'Outro cliente', active: false },
      ],
    });
    await p.campaign.createMany({
      data: [
        { id: '120000000000001', adAccountId: 'act_1', name: 'Camp' },
        { id: '999', adAccountId: 'act_2', name: 'Alheia' },
      ],
    });
    await p.campaignDaily.createMany({
      data: [
        { campaignId: '120000000000001', date: '2026-03-10', spendCents: 5000 },
        { campaignId: '999', date: '2026-03-10', spendCents: 900000 },
      ],
    });
    await m.receiveWebhook('kiwify', req('kiwify', kiwifyBody({ order_status: 'paid', approved_date: '2026-03-10 11:00' })));
    const f = m.parseFilters({ period: 'hoje' });
    const { summary } = await m.loadSummary(f, new Date('2026-03-10T23:00:00-03:00'));
    expect(summary.spendCents).toBe(5000);
    expect(summary.netRevenueCents).toBe(8900);
    expect(summary.roas).toBeCloseTo(1.78);

    const camp = await m.loadCampaigns(f, new Date('2026-03-10T23:00:00-03:00'));
    expect(camp.rows).toHaveLength(1);
    expect(camp.rows[0]).toMatchObject({ name: 'Camp', sales: 1, revenueCents: 8900, spendCents: 5000 });
  });
});
