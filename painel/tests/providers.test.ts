import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { kiwify } from '@/lib/providers/kiwify';
import { wiapy } from '@/lib/providers/wiapy';
import { enabledPlatformIds, getEnabledProvider } from '@/lib/providers';
import { mergeStatus } from '@/lib/providers/types';
import { campaignIdFromUtm, extractTracking, trafficSource } from '@/lib/tracking';

const kiwifyPaid = {
  order_id: 'a1b2c3',
  order_ref: 'XyZ',
  order_status: 'paid',
  webhook_event_type: 'order_approved',
  payment_method: 'credit_card',
  created_at: '2026-03-10 20:50',
  approved_date: '2026-03-10 21:30',
  refunded_at: null,
  Product: { product_id: 'p1', product_name: 'Curso X' },
  Customer: { full_name: 'Ana Souza', email: 'ANA@EX.COM', mobile: '+5511999998888', ip: '177.1.2.3' },
  Commissions: { charge_amount: 11690, product_base_price: 9700, my_commission: 10300 },
  TrackingParameters: { utm_source: 'FB', utm_medium: 'paid', utm_campaign: 'Black|120210000000001', fbclid: 'IwAR123' },
};

describe('Kiwify', () => {
  it('mapeia venda aprovada: total com orderbump, líquido, datas em Brasília', () => {
    const r = kiwify.parse(kiwifyPaid);
    expect(r.kind).toBe('sale');
    if (r.kind !== 'sale') return;
    expect(r.sale.externalId).toBe('a1b2c3');
    expect(r.sale.status).toBe('approved');
    expect(r.sale.grossCents).toBe(11690);
    expect(r.sale.netCents).toBe(10300);
    expect(r.sale.paymentMethod).toBe('card');
    expect(r.sale.paidAt!.toISOString()).toBe('2026-03-11T00:30:00.000Z');
    expect(r.sale.customerEmail).toBe('ana@ex.com');
    expect(r.sale.tracking.utmCampaign).toBe('Black|120210000000001');
    expect(r.sale.tracking.fbclid).toBe('IwAR123');
    expect(r.sale.tracking.clientIp).toBe('177.1.2.3');
  });

  it('pendente não tem data de pagamento', () => {
    const r = kiwify.parse({ ...kiwifyPaid, order_status: 'waiting_payment', payment_method: 'pix', approved_date: null });
    expect(r.kind === 'sale' && r.sale.status).toBe('pending');
    expect(r.kind === 'sale' && r.sale.paidAt).toBeNull();
  });

  it('carrinho abandonado é ignorado (não vira venda pendente)', () => {
    const r = kiwify.parse({ id: 'chk_1', checkout_link: 'x', status: 'abandoned', webhook_event_type: 'cart_abandoned' });
    expect(r.kind).toBe('ignored');
    const r2 = kiwify.parse({ id: 'chk_1', checkout_link: 'x', status: 'abandoned' });
    expect(r2.kind).toBe('ignored');
  });

  it('status desconhecido é erro, não venda', () => {
    expect(kiwify.parse({ ...kiwifyPaid, order_status: 'estranho' }).kind).toBe('error');
  });

  it('valor decimal onde a Kiwify manda centavos vira erro (não número 100× fora)', () => {
    const r = kiwify.parse({ ...kiwifyPaid, Commissions: { charge_amount: 116.9, my_commission: 103 } });
    expect(r.kind).toBe('error');
  });

  it('assinatura HMAC-SHA1 do corpo', () => {
    const body = JSON.stringify(kiwifyPaid);
    const sig = createHmac('sha1', 'tok').update(body).digest('hex');
    const req = (s: string) => ({ rawBody: body, headers: new Headers(), url: new URL(`https://x/api?signature=${s}`) });
    expect(kiwify.verify(req(sig), 'tok')).toBe(true);
    expect(kiwify.verify(req('00'), 'tok')).toBe(false);
    expect(kiwify.verify(req(sig), 'outro')).toBe(false);
  });
});

describe('Wiapy (estrito)', () => {
  afterEach(() => {
    delete process.env.WIAPY_AMOUNT_UNIT;
  });

  const paid = {
    event: 'payment.paid',
    checkout: { id: 'CHK-9', amount: 9700, product: { id: 'p9', name: 'Mapas' } },
    payment: { id: 'PAY-1', status: 'paid', method: 'pix', amount: 11690, net_amount: 10500, dt_created: '2026-03-01 10:00:00', dt_update: '2026-03-05 21:30:00' },
    customer: { name: 'Bia', email: 'bia@ex.com' },
    trackProps: { utm_source: 'facebook', utm_campaign: 'C|120000000000777', fbclid: 'abc', useragent: 'Mozilla/5', ip: '1.2.3.4', fbp: 'fb.1.1.1' },
  };

  it('sem WIAPY_AMOUNT_UNIT, todo evento é erro (unidade nunca adivinhada)', () => {
    const r = wiapy.parse(paid);
    expect(r.kind).toBe('error');
  });

  it('usa payment.amount (com orderbump), nunca checkout.amount; id do pagamento, nunca do checkout', () => {
    process.env.WIAPY_AMOUNT_UNIT = 'cents';
    const r = wiapy.parse(paid);
    expect(r.kind).toBe('sale');
    if (r.kind !== 'sale') return;
    expect(r.sale.grossCents).toBe(11690);
    expect(r.sale.externalId).toBe('PAY-1');
    expect(r.sale.netCents).toBe(10500);
    expect(r.sale.paidAt!.toISOString()).toBe('2026-03-06T00:30:00.000Z');
    expect(r.sale.orderedAt.toISOString()).toBe('2026-03-01T13:00:00.000Z');
    expect(r.sale.tracking.userAgent).toBe('Mozilla/5');
    expect(r.sale.tracking.fbp).toBe('fb.1.1.1');
  });

  it('dt_update de um reembolso NÃO vira data de pagamento', () => {
    process.env.WIAPY_AMOUNT_UNIT = 'cents';
    const r = wiapy.parse({ ...paid, payment: { ...paid.payment, status: 'refunded', dt_update: '2026-03-20 10:00:00' } });
    expect(r.kind).toBe('sale');
    if (r.kind !== 'sale') return;
    expect(r.sale.paidAt).toBeNull();
    expect(r.sale.refundedAt!.toISOString()).toBe('2026-03-20T13:00:00.000Z');
  });

  it('decimal declarado lê 117.90 como R$ 117,90', () => {
    process.env.WIAPY_AMOUNT_UNIT = 'decimal';
    const r = wiapy.parse({ ...paid, payment: { ...paid.payment, amount: '116.90', net_amount: -0.11 } });
    expect(r.kind === 'sale' && r.sale.grossCents).toBe(11690);
    expect(r.kind === 'sale' && r.sale.netCents).toBe(-11);
  });

  it('carrinho abandonado e sessão de checkout são ignorados, mesmo com id e valor', () => {
    process.env.WIAPY_AMOUNT_UNIT = 'cents';
    expect(wiapy.parse({ event: 'cart.abandoned', checkout: { id: 'CHK-9', amount: 9700 } }).kind).toBe('ignored');
    // só id de checkout, sem pagamento: não pode virar venda pendente
    expect(wiapy.parse({ event: 'x', checkout: { id: 'CHK-9', amount: 9700 }, status: 'pending' }).kind).toBe('ignored');
    expect(wiapy.parse({ event: 'withdraw.created', payment: { id: 'W1', amount: 1 } }).kind).toBe('ignored');
  });

  it('sem valor líquido: erro (não grava número inventado)', () => {
    process.env.WIAPY_AMOUNT_UNIT = 'cents';
    const { net_amount: _, ...p } = paid.payment;
    const r = wiapy.parse({ ...paid, payment: p });
    expect(r.kind).toBe('error');
  });

  it('verifica token por cabeçalho, query e HMAC', () => {
    const body = '{}';
    const mk = (url: string, h: Record<string, string> = {}) => ({ rawBody: body, headers: new Headers(h), url: new URL(url) });
    expect(wiapy.verify(mk('https://x/?token=s3'), 's3')).toBe(true);
    expect(wiapy.verify(mk('https://x/', { authorization: 'Bearer s3' }), 's3')).toBe(true);
    const sig = createHmac('sha256', 's3').update(body).digest('hex');
    expect(wiapy.verify(mk('https://x/', { 'x-signature': sig }), 's3')).toBe(true);
    expect(wiapy.verify(mk('https://x/?token=errado'), 's3')).toBe(false);
    expect(wiapy.verify(mk('https://x/'), 's3')).toBe(false);
  });
});

describe('plataformas habilitadas', () => {
  it('só existe endpoint para a plataforma em uso', () => {
    expect(enabledPlatformIds('')).toEqual([]);
    expect(enabledPlatformIds('wiapy, hotmart')).toEqual(['wiapy']);
    expect(getEnabledProvider('kiwify', 'wiapy')).toBeNull();
    expect(getEnabledProvider('wiapy', 'wiapy')?.id).toBe('wiapy');
  });
});

describe('status', () => {
  it('evento atrasado não rebaixa', () => {
    expect(mergeStatus('approved', 'pending')).toBe('approved');
    expect(mergeStatus('pending', 'approved')).toBe('approved');
    expect(mergeStatus('approved', 'refunded')).toBe('refunded');
    expect(mergeStatus('refunded', 'approved')).toBe('refunded');
    expect(mergeStatus('pending', 'refused')).toBe('refused');
  });
});

describe('rastreamento', () => {
  it('lê trackProps, tracking e TrackingParameters, com grafias diferentes', () => {
    const a = extractTracking({ trackProps: { utm_source: 'fb', user_agent: 'UA1', fbc: 'fb.1.2.x' } });
    const b = extractTracking({ data: { tracking: { utmSource: 'fb', useragent: 'UA2', client_ip: '9.9.9.9' } } });
    const c = extractTracking({ TrackingParameters: { utm_source: 'ig' }, Customer: { ip: '8.8.8.8' } });
    expect([a.utmSource, a.userAgent, a.fbc]).toEqual(['fb', 'UA1', 'fb.1.2.x']);
    expect([b.utmSource, b.userAgent, b.clientIp]).toEqual(['fb', 'UA2', '9.9.9.9']);
    expect([c.utmSource, c.clientIp]).toEqual(['ig', '8.8.8.8']);
  });

  it('tira fbclid e utm de uma URL de origem', () => {
    const t = extractTracking({ tracking: { landing_url: 'https://lp.com/?utm_source=fb&utm_campaign=X%7C123456789&fbclid=ZZ' } });
    expect(t.fbclid).toBe('ZZ');
    expect(t.utmCampaign).toBe('X|123456789');
  });

  it('ignora placeholders não substituídos', () => {
    expect(extractTracking({ tracking: { utm_campaign: '{{campaign.name}}' } }).utmCampaign).toBeNull();
  });

  it('id da campanha a partir de "Nome|ID" e fonte', () => {
    expect(campaignIdFromUtm('Black Friday|120210000000001')).toBe('120210000000001');
    expect(campaignIdFromUtm('Sem id')).toBeNull();
    expect(trafficSource({ utmSource: 'FB', fbclid: null })).toBe('Meta');
    expect(trafficSource({ utmSource: null, fbclid: 'x' })).toBe('Meta');
    expect(trafficSource({ utmSource: null, fbclid: null })).toBe('Direto');
    expect(trafficSource({ utmSource: 'google', fbclid: null })).toBe('Google');
  });
});

import { hubla } from '@/lib/providers/hubla';

describe('Hubla (estrito)', () => {
  const pago = {
    type: 'invoice.payment_succeeded',
    version: '2.0.0',
    event: {
      product: { id: 'prod-1', name: 'Religioso' },
      invoice: {
        id: 'inv-1',
        status: 'paid',
        paymentMethod: 'pix',
        amount: { subtotalCents: 9700, discountCents: 0, totalCents: 11690 },
        createdAt: '2026-03-10T23:30:00.000Z',
        paidAt: '2026-03-11T00:30:00.000Z',
        receivers: [
          { role: 'platform', totalCents: 990 },
          { role: 'seller', totalCents: 10700 },
        ],
        paymentSession: {
          utm: { source: 'FB', medium: 'paid', campaign: 'Camp|120200000000001', content: 'ad1' },
          ip: '1.2.3.4',
          userAgent: 'Mozilla',
        },
      },
      user: { firstName: 'Ana', lastName: 'Souza', email: 'ANA@X.COM', phone: '+5511999998888' },
    },
  };

  it('mapeia fatura paga: total, líquido do vendedor, data com fuso, utm sem prefixo', () => {
    const r = hubla.parse(pago);
    expect(r.kind).toBe('sale');
    if (r.kind !== 'sale') return;
    expect(r.sale).toMatchObject({ externalId: 'inv-1', status: 'approved', grossCents: 11690, netCents: 10700, paymentMethod: 'pix' });
    expect(r.sale.paidAt!.toISOString()).toBe('2026-03-11T00:30:00.000Z');
    expect(r.sale.tracking.utmCampaign).toBe('Camp|120200000000001');
    expect(r.sale.tracking.utmSource).toBe('FB');
    expect(r.sale.tracking.userAgent).toBe('Mozilla');
    expect(r.sale.customerName).toBe('Ana Souza');
    expect(r.sale.customerEmail).toBe('ana@x.com');
  });

  it('lead / carrinho abandonado e assinatura são ignorados', () => {
    expect(hubla.parse({ type: 'lead.abandoned_checkout', event: { invoice: { id: 'x', amount: { totalCents: 1 } } } }).kind).toBe('ignored');
    expect(hubla.parse({ type: 'subscription.activated', event: {} }).kind).toBe('ignored');
    expect(hubla.parse({ type: 'customer.member_added', event: {} }).kind).toBe('ignored');
  });

  it('reembolso: sem data de pagamento nova; data do reembolso pelo updatedAt', () => {
    const inv = { ...pago.event.invoice, status: 'refunded', paidAt: undefined, updatedAt: '2026-03-20T13:00:00.000Z' };
    const r = hubla.parse({ ...pago, type: 'invoice.refunded', event: { ...pago.event, invoice: inv } });
    expect(r.kind === 'sale' && r.sale.status).toBe('refunded');
    expect(r.kind === 'sale' && r.sale.paidAt).toBeNull();
    expect(r.kind === 'sale' && r.sale.refundedAt!.toISOString()).toBe('2026-03-20T13:00:00.000Z');
  });

  it('pendente não tem data de pagamento; status pelo tipo quando falta', () => {
    const inv = { ...pago.event.invoice, status: undefined, paidAt: undefined };
    const r = hubla.parse({ ...pago, type: 'invoice.created', event: { ...pago.event, invoice: inv } });
    expect(r.kind === 'sale' && r.sale.status).toBe('pending');
    expect(r.kind === 'sale' && r.sale.paidAt).toBeNull();
  });

  it('sem líquido do vendedor: erro, nada gravado', () => {
    const inv = { ...pago.event.invoice, receivers: [{ role: 'platform', totalCents: 990 }] };
    expect(hubla.parse({ ...pago, event: { ...pago.event, invoice: inv } }).kind).toBe('error');
  });

  it('valor sem "Cents" no nome não é lido (unidade nunca adivinhada)', () => {
    const inv = { ...pago.event.invoice, amount: { total: 116.9 } };
    expect(hubla.parse({ ...pago, event: { ...pago.event, invoice: inv } }).kind).toBe('error');
  });

  it('token no cabeçalho x-hubla-token', () => {
    const mk = (h: Record<string, string>) => ({ rawBody: '{}', headers: new Headers(h), url: new URL('https://x/') });
    expect(hubla.verify(mk({ 'x-hubla-token': 'tok-123' }), 'tok-123')).toBe(true);
    expect(hubla.verify(mk({ 'x-hubla-token': 'errado' }), 'tok-123')).toBe(false);
    expect(hubla.verify(mk({}), 'tok-123')).toBe(false);
  });
});
