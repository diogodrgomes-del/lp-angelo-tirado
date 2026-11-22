'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { parseBRL } from '@/lib/money';
import { connectMeta, META_ID, syncMeta } from '@/lib/sync';
import { reprocessAll } from '@/lib/webhook';
import { getEnabledProvider } from '@/lib/providers';
import { setSecretSetting, setSetting } from '@/lib/settings';
import { flushCapi } from '@/lib/sales';

export interface ActionState {
  ok: boolean;
  msg: string;
}

const done = (msg: string): ActionState => {
  revalidatePath('/', 'layout');
  return { ok: true, msg };
};
const fail = (msg: string): ActionState => ({ ok: false, msg });

async function guard<T extends ActionState>(fn: () => Promise<T>): Promise<ActionState> {
  try {
    await requireSession();
  } catch {
    return fail('Sessão expirada. Entre de novo.');
  }
  try {
    return await fn();
  } catch (e) {
    return fail((e as Error).message);
  }
}

/* ── Meta Ads ─────────────────────────────────────────────────────────── */

export async function saveMetaToken(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const token = String(fd.get('token') ?? '').trim();
    const kind = fd.get('kind') === 'user' ? 'user' : 'system_user';
    if (token.length < 20) return fail('Cole o token de acesso completo.');
    const r = await connectMeta(token, kind, kind === 'user' ? new Date(Date.now() + 60 * 86_400_000) : null);
    const sync = r.active ? await syncMeta(90) : null;
    return done(
      `Conectado: ${r.accounts} conta(s) visível(is), ${r.active} ativa(s).` +
        (r.accounts > 1 && r.active === 0 ? ' Marque abaixo só as contas deste produto.' : '') +
        (sync ? ` ${sync.rows} linha(s) de gasto importadas.` : ''),
    );
  });
}

export async function disconnectMeta(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    await prisma.integration.update({
      where: { id: META_ID },
      data: { credentials: null, status: 'disconnected', tokenExpiresAt: null, tokenKind: null, lastError: null },
    });
    return done('Meta Ads desconectada. Contas e histórico de gasto foram mantidos.');
  });
}

export async function saveAccountSelection(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const chosen = new Set(fd.getAll('account').map(String));
    const all = await prisma.adAccount.findMany({ select: { id: true } });
    await prisma.$transaction(
      all.map((a) => prisma.adAccount.update({ where: { id: a.id }, data: { active: chosen.has(a.id) } })),
    );
    const sync = chosen.size ? await syncMeta(90) : null;
    return done(`${chosen.size} conta(s) ativa(s).${sync ? ` Gasto dos últimos 90 dias atualizado.` : ''}`);
  });
}

export async function removeInactiveAccounts(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const r = await prisma.adAccount.deleteMany({ where: { active: false } });
    return done(`${r.count} conta(s) desmarcada(s) removida(s), com campanhas e gasto.`);
  });
}

/* ── Conversions API ──────────────────────────────────────────────────── */

export async function saveCapi(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const pixel = String(fd.get('pixel') ?? '').trim();
    const test = String(fd.get('test') ?? '').trim();
    const token = String(fd.get('token') ?? '').trim();
    if (pixel && !/^\d{8,20}$/.test(pixel)) return fail('O ID do pixel tem só números.');
    await setSetting('capi_pixel_id', pixel || null);
    await setSetting('capi_test_code', test || null);
    if (token) await setSecretSetting('capi_token', token);
    if (fd.get('clear_token') === '1') await setSecretSetting('capi_token', null);
    const r = pixel ? await flushCapi() : { sent: 0, failed: 0 };
    return done(
      `Conversions API salva${test ? ' (modo de TESTE: os eventos não contam para a otimização)' : ''}.` +
        (r.sent || r.failed ? ` Enviadas: ${r.sent}, com erro: ${r.failed}.` : ''),
    );
  });
}

/* ── Checkout ─────────────────────────────────────────────────────────── */

export async function saveWebhookSecret(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const platform = String(fd.get('platform') ?? '');
    if (!getEnabledProvider(platform)) return fail('Plataforma não habilitada.');
    if (fd.get('remove') === '1') {
      await prisma.integration.update({ where: { id: platform }, data: { webhookSecret: null } });
      return done('Segredo removido. O webhook está ABERTO: aceita qualquer requisição.');
    }
    const secret = String(fd.get('secret') ?? '').trim();
    if (secret.length < 8) return fail('O segredo precisa de pelo menos 8 caracteres.');
    await prisma.integration.update({
      where: { id: platform },
      data: { webhookSecret: encrypt(secret), lastError: null },
    });
    return done('Segredo salvo. Webhook sem o segredo correto agora é recusado.');
  });
}

export async function reprocessWebhooks(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const c = await reprocessAll(String(fd.get('platform') ?? ''));
    return done(`Reprocessado: ${c.processed} venda(s), ${c.ignored} ignorado(s), ${c.error} com erro.`);
  });
}

/* ── Custos e parâmetros ──────────────────────────────────────────────── */

export async function saveProductCosts(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const ops = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('cost:')) continue;
      const key = k.slice(5);
      const name = String(fd.get(`name:${key}`) ?? key);
      const raw = String(v).trim();
      const cents = raw ? parseBRL(raw) : 0;
      if (cents < 0) return fail(`Custo negativo em "${name}".`);
      ops.push(
        prisma.productCost.upsert({ where: { key }, create: { key, name, costCents: cents }, update: { name, costCents: cents } }),
      );
    }
    await prisma.$transaction(ops);
    return done('Custos salvos.');
  });
}

export async function saveCalcParams(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const taxRaw = String(fd.get('tax') ?? '').trim().replace(',', '.');
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(taxRaw)) return fail('Imposto inválido. Ex.: 7,38');
    const [i, d = ''] = taxRaw.split('.');
    const bps = Number(i) * 100 + Number(d.padEnd(2, '0'));
    const fixed = parseBRL(String(fd.get('fixed') ?? '0') || '0');
    if (fixed < 0) return fail('Custo fixo não pode ser negativo.');
    await setSetting('tax_bps', String(bps));
    await setSetting('fixed_cost_cents', String(fixed));
    return done('Parâmetros salvos.');
  });
}
