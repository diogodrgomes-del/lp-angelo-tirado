import { prisma } from './db';
import { decrypt, encrypt } from './crypto';
import { addDays, dayKey } from './dates';
import {
  activationFor,
  balanceCents,
  fetchAdAccounts,
  fetchCampaigns,
  fetchInsights,
  parseInsight,
  type MetaAdAccount,
} from './meta';

export const META_ID = 'meta_ads';

/** Guarda o token e importa as contas. Reconectar NÃO desfaz a seleção já feita. */
export async function connectMeta(
  token: string,
  kind: 'user' | 'system_user',
  expiresAt: Date | null,
): Promise<{ accounts: number; active: number }> {
  const accounts = await fetchAdAccounts(token); // valida o token antes de gravar
  await prisma.integration.upsert({
    where: { id: META_ID },
    create: {
      id: META_ID,
      credentials: encrypt(token),
      tokenKind: kind,
      tokenExpiresAt: expiresAt,
      status: 'ok',
      lastError: null,
    },
    update: { credentials: encrypt(token), tokenKind: kind, tokenExpiresAt: expiresAt, status: 'ok', lastError: null },
  });
  const active = await upsertAccounts(accounts);
  return { accounts: accounts.length, active };
}

async function upsertAccounts(accounts: MetaAdAccount[]): Promise<number> {
  const known = await prisma.adAccount.findMany({ select: { id: true, active: true } });
  const activation = activationFor(
    accounts.map((a) => a.id),
    new Map(known.map((k) => [k.id, k.active])),
  );
  for (const a of accounts) {
    const data = {
      name: a.name,
      currency: a.currency ?? 'BRL',
      timezone: a.timezone_name ?? null,
      balanceCents: balanceCents(a.balance),
    };
    await prisma.adAccount.upsert({
      where: { id: a.id },
      create: { id: a.id, ...data, active: activation.get(a.id) ?? false },
      update: data, // "active" nunca é tocado aqui
    });
  }
  return [...activation.values()].filter(Boolean).length;
}

export interface SyncResult {
  ok: boolean;
  rows: number;
  errors: string[];
}

/**
 * Baixa o gasto diário por campanha das contas ATIVAS.
 * days = quantos dias para trás (inclui hoje). A Meta ainda ajusta o gasto
 * dos últimos dias, por isso o sync recorrente sempre relê alguns dias.
 */
export async function syncMeta(days = 3, now = new Date()): Promise<SyncResult> {
  const integration = await prisma.integration.findUnique({ where: { id: META_ID } });
  if (!integration?.credentials) return { ok: false, rows: 0, errors: ['Meta Ads não conectada'] };

  const errors: string[] = [];
  let rows = 0;
  let token: string;
  try {
    token = decrypt(integration.credentials);
  } catch (e) {
    const msg = (e as Error).message;
    await prisma.integration.update({ where: { id: META_ID }, data: { status: 'error', lastError: msg } });
    return { ok: false, rows: 0, errors: [msg] };
  }

  // atualiza nomes, saldo e descobre contas novas (que entram inativas)
  try {
    await upsertAccounts(await fetchAdAccounts(token));
  } catch (e) {
    errors.push((e as Error).message);
  }

  const until = dayKey(now);
  const since = addDays(until, -(Math.max(1, days) - 1));
  const accounts = await prisma.adAccount.findMany({ where: { active: true } });

  for (const acc of accounts) {
    try {
      const [campaigns, insights] = await Promise.all([
        fetchCampaigns(acc.id, token),
        fetchInsights(acc.id, token, since, until),
      ]);
      const names = new Map<string, { name: string; status: string | null }>();
      for (const c of campaigns) names.set(c.id, { name: c.name, status: c.effective_status ?? null });
      const parsed = insights.map(parseInsight);
      for (const p of parsed) if (!names.has(p.campaignId)) names.set(p.campaignId, { name: p.campaignName, status: null });

      await prisma.$transaction(
        [...names.entries()].map(([id, c]) =>
          prisma.campaign.upsert({
            where: { id },
            create: { id, adAccountId: acc.id, name: c.name, status: c.status },
            update: { adAccountId: acc.id, name: c.name, ...(c.status ? { status: c.status } : {}) },
          }),
        ),
      );
      for (let i = 0; i < parsed.length; i += 100) {
        await prisma.$transaction(
          parsed.slice(i, i + 100).map((p) =>
            prisma.campaignDaily.upsert({
              where: { campaignId_date: { campaignId: p.campaignId, date: p.date } },
              create: {
                campaignId: p.campaignId,
                date: p.date,
                spendCents: p.spendCents,
                impressions: p.impressions,
                clicks: p.clicks,
              },
              update: { spendCents: p.spendCents, impressions: p.impressions, clicks: p.clicks },
            }),
          ),
        );
      }
      rows += parsed.length;
      await prisma.adAccount.update({ where: { id: acc.id }, data: { lastError: null } });
    } catch (e) {
      const msg = `${acc.name}: ${(e as Error).message}`;
      errors.push(msg);
      await prisma.adAccount.update({ where: { id: acc.id }, data: { lastError: (e as Error).message } });
    }
  }

  await prisma.integration.update({
    where: { id: META_ID },
    data: {
      lastSyncAt: new Date(),
      status: errors.length ? 'error' : 'ok',
      lastError: errors.length ? errors.join('\n').slice(0, 2000) : null,
    },
  });
  return { ok: errors.length === 0, rows, errors };
}

/** Sync oportunista: chamado ao abrir o Resumo, se o último tiver mais de N minutos. */
export async function isMetaStale(minutes = 15): Promise<boolean> {
  const i = await prisma.integration.findUnique({ where: { id: META_ID }, select: { lastSyncAt: true, credentials: true } });
  if (!i?.credentials) return false;
  return !i.lastSyncAt || Date.now() - i.lastSyncAt.getTime() > minutes * 60_000;
}
