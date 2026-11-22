import { prisma } from './db';
import { enabledPlatformIds, ALL_PROVIDERS } from './providers';
import { productKey } from './metrics';
import { getSetting } from './settings';
import { META_ID } from './sync';

/**
 * Avisos de número errado. Cada um destes já aconteceu em produção e
 * NENHUM dá erro visível: todos produzem um número plausível e errado.
 */
export interface Warning {
  level: 'erro' | 'aviso';
  text: string;
  href?: string;
}

export async function healthWarnings(): Promise<Warning[]> {
  const out: Warning[] = [];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [meta, integrations, activeAccounts, errorEvents, products, costs, testCode, recentSales] = await Promise.all([
    prisma.integration.findUnique({ where: { id: META_ID } }),
    prisma.integration.findMany({ where: { id: { in: enabledPlatformIds() } } }),
    prisma.adAccount.count({ where: { active: true } }),
    prisma.webhookEvent.count({ where: { status: 'error', receivedAt: { gte: weekAgo } } }),
    prisma.sale.findMany({
      where: { status: 'approved' },
      distinct: ['platform', 'productId', 'productName'],
      select: { platform: true, productId: true, productName: true },
    }),
    prisma.productCost.findMany(),
    getSetting('capi_test_code'),
    prisma.sale.findMany({
      where: { status: 'approved', origin: 'webhook', paidAt: { gte: weekAgo } },
      select: { utmSource: true, fbclid: true },
    }),
  ]);

  if (!meta?.credentials) {
    out.push({ level: 'aviso', text: 'Meta Ads não conectada: gasto, ROAS e lucro ficam sem a mídia.', href: '/integracoes' });
  } else {
    if (meta.status === 'error') {
      out.push({
        level: 'erro',
        text: `Meta Ads com erro — o gasto parou de atualizar e o lucro está otimista. ${meta.lastError?.split('\n')[0] ?? ''}`,
        href: '/integracoes',
      });
    }
    if (meta.tokenExpiresAt) {
      const days = Math.floor((meta.tokenExpiresAt.getTime() - Date.now()) / 86_400_000);
      if (days < 10) {
        out.push({
          level: days < 0 ? 'erro' : 'aviso',
          text:
            days < 0
              ? 'O token da Meta expirou. Troque por um token de System User, que não expira.'
              : `O token da Meta expira em ${days} dia(s). Troque por um token de System User, que não expira.`,
          href: '/integracoes',
        });
      }
    }
    if (activeAccounts === 0) {
      out.push({ level: 'aviso', text: 'Nenhuma conta de anúncio marcada: o gasto está zerado.', href: '/integracoes' });
    }
  }

  for (const i of integrations) {
    if (!i.webhookSecret) {
      out.push({
        level: 'aviso',
        text: `Webhook da ${ALL_PROVIDERS[i.id].label} está aberto (sem segredo): qualquer um pode criar vendas falsas.`,
        href: '/integracoes',
      });
    }
  }
  if (errorEvents > 0) {
    out.push({
      level: 'erro',
      text: `${errorEvents} webhook(s) com erro de mapeamento nos últimos 7 dias — essas vendas não estão nos números. Os payloads estão guardados para reprocessar.`,
      href: '/integracoes',
    });
  }

  const costKeys = new Map(costs.map((c) => [c.key, c.costCents]));
  const noCost = products.filter((p) => !costKeys.get(productKey(p.platform, p.productId, p.productName)));
  if (noCost.length) {
    out.push({
      level: 'aviso',
      text: `${noCost.length} produto(s) com custo R$ 0,00 — o lucro está otimista se houver custo de produção ou entrega.`,
      href: '/integracoes',
    });
  }

  if (testCode) {
    out.push({
      level: 'aviso',
      text: 'Conversions API com código de teste: as vendas vão só para "Testar eventos" e não ajudam a otimização.',
      href: '/integracoes',
    });
  }

  if (recentSales.length >= 5 && meta?.credentials) {
    const direct = recentSales.filter((s) => !s.utmSource && !s.fbclid).length;
    if (direct / recentSales.length > 0.6) {
      out.push({
        level: 'aviso',
        text: `${Math.round((direct / recentSales.length) * 100)}% das vendas dos últimos 7 dias chegaram sem UTM nem fbclid. A landing page provavelmente não está repassando os parâmetros ao checkout.`,
      });
    }
  }
  return out;
}
