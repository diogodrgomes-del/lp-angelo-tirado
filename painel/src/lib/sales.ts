import type { Sale } from '@prisma/client';
import { prisma } from './db';
import { mergeStatus, type NormalizedSale, type SaleStatus } from './providers/types';
import { campaignIdFromUtm } from './tracking';
import { buildPurchaseEvent, sendCapi } from './capi';
import { getCapiConfig } from './settings';

const TRACK_FIELDS = [
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'src',
  'fbclid',
  'fbc',
  'fbp',
  'clientIp',
  'userAgent',
] as const;

const APPROVED_LIKE = new Set(['approved', 'refunded', 'chargeback']);

export interface UpsertResult {
  sale: Sale;
  created: boolean;
  becameApproved: boolean;
  skipped?: string;
}

/**
 * Grava ou atualiza uma venda pelo (plataforma, id do pedido).
 * - Evento atrasado não rebaixa status (aprovado não volta a pendente).
 * - Data de pagamento já conhecida não é trocada por um evento posterior
 *   (um "paid" repetido com dt_update novo não move a receita de dia).
 * - Rastreamento: o primeiro valor não vazio fica.
 * - Importação nunca sobrescreve o que veio do webhook.
 */
export async function upsertSale(
  platform: string,
  s: NormalizedSale,
  origin: 'webhook' | 'import',
): Promise<UpsertResult> {
  const existing = await prisma.sale.findUnique({
    where: { platform_externalId: { platform, externalId: s.externalId } },
  });

  if (!existing) {
    const sale = await prisma.sale.create({
      data: {
        platform,
        externalId: s.externalId,
        status: s.status,
        paymentMethod: s.paymentMethod,
        productId: s.productId,
        productName: s.productName,
        customerName: s.customerName,
        customerEmail: s.customerEmail,
        customerPhone: s.customerPhone,
        grossCents: s.grossCents,
        netCents: s.netCents,
        orderedAt: s.orderedAt,
        paidAt: s.paidAt,
        refundedAt: s.refundedAt,
        ...s.tracking,
        campaignId: campaignIdFromUtm(s.tracking.utmCampaign),
        origin,
      },
    });
    return { sale, created: true, becameApproved: s.status === 'approved' };
  }

  if (origin === 'import' && existing.origin === 'webhook') {
    return { sale: existing, created: false, becameApproved: false, skipped: 'já veio pelo webhook' };
  }

  const webhookOverImport = origin === 'webhook' && existing.origin === 'import';
  const status = webhookOverImport ? s.status : mergeStatus(existing.status as SaleStatus, s.status);
  const adopted = status === s.status;

  const tracking: Record<string, string | null> = {};
  for (const f of TRACK_FIELDS) tracking[f] = existing[f] ?? s.tracking[f];

  const sale = await prisma.sale.update({
    where: { id: existing.id },
    data: {
      status,
      paymentMethod: s.paymentMethod !== 'other' ? s.paymentMethod : existing.paymentMethod,
      productId: s.productId ?? existing.productId,
      productName: s.productName !== 'Produto sem nome' ? s.productName : existing.productName,
      customerName: s.customerName ?? existing.customerName,
      customerEmail: s.customerEmail ?? existing.customerEmail,
      customerPhone: s.customerPhone ?? existing.customerPhone,
      grossCents: adopted ? s.grossCents : existing.grossCents,
      netCents: adopted ? s.netCents : existing.netCents,
      orderedAt: webhookOverImport ? s.orderedAt : existing.orderedAt,
      paidAt: webhookOverImport ? (s.paidAt ?? existing.paidAt) : (existing.paidAt ?? s.paidAt),
      refundedAt: existing.refundedAt ?? s.refundedAt,
      ...tracking,
      campaignId: campaignIdFromUtm(tracking.utmCampaign),
      origin: webhookOverImport ? 'webhook' : existing.origin,
    },
  });
  return {
    sale,
    created: false,
    becameApproved: status === 'approved' && !APPROVED_LIKE.has(existing.status),
  };
}

/**
 * Envia para a Conversions API as vendas aprovadas ainda não enviadas.
 * Só vendas do webhook pagas nos últimos 7 dias (a Meta recusa eventos mais
 * antigos, e importar histórico não deve virar compra nova para a Meta).
 */
export async function flushCapi(saleIds?: string[]): Promise<{ sent: number; failed: number }> {
  const cfg = await getCapiConfig();
  if (!cfg) return { sent: 0, failed: 0 };
  const since = new Date(Date.now() - 7 * 86_400_000);
  const sales = await prisma.sale.findMany({
    where: {
      status: 'approved',
      origin: 'webhook',
      capiSentAt: null,
      paidAt: { gte: since },
      ...(saleIds ? { id: { in: saleIds } } : {}),
    },
    take: 200,
  });
  let sent = 0;
  let failed = 0;
  for (const sale of sales) {
    try {
      await sendCapi([buildPurchaseEvent(sale)], cfg.pixelId, cfg.token, cfg.testCode);
      await prisma.sale.update({ where: { id: sale.id }, data: { capiSentAt: new Date(), capiError: null } });
      sent++;
    } catch (e) {
      await prisma.sale.update({ where: { id: sale.id }, data: { capiError: (e as Error).message.slice(0, 500) } });
      failed++;
    }
  }
  return { sent, failed };
}
