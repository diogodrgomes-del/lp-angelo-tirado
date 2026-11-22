// Roda no build da Vercel, depois de `prisma migrate deploy`. Idempotente.
// - Cria a linha da Meta Ads e de cada checkout em CHECKOUT_PLATFORMS.
// - Desliga checkout que saiu de CHECKOUT_PLATFORMS (o endpoint deixa de existir).
// - Grava a impressão digital da ENCRYPTION_KEY e ABORTA o deploy se ela mudou
//   depois que alguma credencial foi cifrada (senão tudo para de abrir).
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const KNOWN = ['hubla', 'wiapy', 'kiwify'];
const prisma = new PrismaClient();

function fail(msg) {
  console.error(`\n[bootstrap] ERRO: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const key = process.env.ENCRYPTION_KEY ?? '';
  if (Buffer.from(key, 'base64').length !== 32) fail('ENCRYPTION_KEY ausente ou inválida (32 bytes em base64: npm run gen-key).');
  if ((process.env.SESSION_SECRET ?? '').length < 32) fail('SESSION_SECRET ausente ou curta (mínimo 32 caracteres).');
  if (!process.env.AUTH_USERS) console.warn('[bootstrap] aviso: AUTH_USERS vazia — ninguém consegue entrar.');

  const fp = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 16);
  const stored = await prisma.setting.findUnique({ where: { key: 'encryption_key_fp' } });
  const hasSecrets =
    (await prisma.integration.count({ where: { OR: [{ credentials: { not: null } }, { webhookSecret: { not: null } }] } })) > 0 ||
    (await prisma.setting.count({ where: { key: 'capi_token' } })) > 0;
  if (stored && stored.value !== fp && hasSecrets) {
    fail('ENCRYPTION_KEY mudou depois que integrações foram conectadas. Volte a chave anterior ou desconecte tudo antes.');
  }
  await prisma.setting.upsert({ where: { key: 'encryption_key_fp' }, create: { key: 'encryption_key_fp', value: fp }, update: { value: fp } });

  const enabled = (process.env.CHECKOUT_PLATFORMS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => KNOWN.includes(s));

  await prisma.integration.upsert({ where: { id: 'meta_ads' }, create: { id: 'meta_ads' }, update: {} });
  for (const id of KNOWN) {
    const on = enabled.includes(id);
    if (on) await prisma.integration.upsert({ where: { id }, create: { id, enabled: true }, update: { enabled: true } });
    else await prisma.integration.updateMany({ where: { id }, data: { enabled: false } });
  }
  console.log(`[bootstrap] ok — checkout habilitado: ${enabled.join(', ') || 'nenhum'}`);
}

main()
  .catch((e) => fail(e.message))
  .finally(() => prisma.$disconnect());
