import type { WebhookEvent } from '@prisma/client';
import { prisma } from './db';
import { decrypt } from './crypto';
import { getEnabledProvider } from './providers';
import type { CheckoutProvider, WebhookRequest } from './providers/types';
import { upsertSale } from './sales';

export const MAX_BODY_BYTES = 1_000_000;

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
  /** vendas que acabaram de ser aprovadas (para a Conversions API) */
  approvedSaleIds: string[];
}

/**
 * Recebe um webhook de checkout.
 * 1. Plataforma não habilitada → 404 (endpoint nem existe).
 * 2. Com segredo cadastrado, assinatura/token errado → 401.
 * 3. Payload cru é gravado ANTES de processar.
 * 4. Processa. Erro de mapeamento não perde nada: o evento fica no banco e é
 *    reprocessado depois da correção. Responde 200 para a plataforma não
 *    reenviar em loop um evento que só a correção do mapeamento resolve.
 */
export async function receiveWebhook(platformId: string, req: WebhookRequest): Promise<WebhookOutcome> {
  const provider = getEnabledProvider(platformId);
  if (!provider) return { status: 404, body: { error: 'not found' }, approvedSaleIds: [] };
  const integration = await prisma.integration.findUnique({ where: { id: platformId } });
  if (!integration || !integration.enabled) {
    return { status: 404, body: { error: 'not found' }, approvedSaleIds: [] };
  }
  if (Buffer.byteLength(req.rawBody) > MAX_BODY_BYTES) {
    return { status: 413, body: { error: 'payload grande demais' }, approvedSaleIds: [] };
  }

  if (integration.webhookSecret) {
    let ok = false;
    try {
      ok = provider.verify(req, decrypt(integration.webhookSecret));
    } catch (e) {
      await prisma.integration.update({
        where: { id: platformId },
        data: { lastError: (e as Error).message },
      });
      return { status: 500, body: { error: 'configuração' }, approvedSaleIds: [] };
    }
    if (!ok) {
      await prisma.integration.update({
        where: { id: platformId },
        data: {
          lastError: `Webhook recusado em ${new Date().toISOString()}: segredo/assinatura não confere.`,
        },
      });
      return { status: 401, body: { error: 'assinatura inválida' }, approvedSaleIds: [] };
    }
  }

  const event = await prisma.webhookEvent.create({
    data: { platform: platformId, rawBody: req.rawBody, status: 'received' },
  });
  const result = await processEvent(provider, event);
  return { status: 200, body: { ok: true, result: result.status }, approvedSaleIds: result.approvedSaleIds };
}

export async function processEvent(
  provider: CheckoutProvider,
  event: Pick<WebhookEvent, 'id' | 'rawBody'>,
): Promise<{ status: string; approvedSaleIds: string[] }> {
  let payload: unknown;
  try {
    payload = JSON.parse(event.rawBody);
  } catch {
    // alguns checkouts mandam form-urlencoded
    try {
      payload = Object.fromEntries(new URLSearchParams(event.rawBody));
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== 'object') {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'error', error: 'corpo não é JSON' },
    });
    return { status: 'error', approvedSaleIds: [] };
  }

  const parsed = provider.parse(payload);
  if (parsed.kind === 'ignored') {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'ignored', eventName: parsed.eventName, error: parsed.reason },
    });
    return { status: 'ignored', approvedSaleIds: [] };
  }
  if (parsed.kind === 'error') {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'error', eventName: parsed.eventName, error: parsed.error },
    });
    return { status: 'error', approvedSaleIds: [] };
  }

  try {
    const r = await upsertSale(provider.id, parsed.sale, 'webhook');
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'processed', eventName: parsed.eventName, externalId: parsed.sale.externalId, error: null },
    });
    return { status: 'processed', approvedSaleIds: r.becameApproved ? [r.sale.id] : [] };
  } catch (e) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'error', eventName: parsed.eventName, error: (e as Error).message.slice(0, 1000) },
    });
    return { status: 'error', approvedSaleIds: [] };
  }
}

/** Reprocessa todos os eventos guardados, em ordem de chegada. Idempotente. */
export async function reprocessAll(platformId: string): Promise<Record<string, number>> {
  const provider = getEnabledProvider(platformId);
  if (!provider) throw new Error('Plataforma não habilitada');
  const counts: Record<string, number> = { processed: 0, ignored: 0, error: 0 };
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.webhookEvent.findMany({
      where: { platform: platformId },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, rawBody: true },
    });
    if (!batch.length) break;
    for (const ev of batch) {
      const r = await processEvent(provider, ev);
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    cursor = batch[batch.length - 1].id;
  }
  return counts;
}
