import { prisma } from './db';
import { decrypt, encrypt } from './crypto';

export const DEFAULT_TAX_BPS = 738; // 7,38%

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getSecretSetting(key: string): Promise<string | null> {
  const v = await getSetting(key);
  return v ? decrypt(v) : null;
}

export async function setSecretSetting(key: string, value: string | null): Promise<void> {
  await setSetting(key, value ? encrypt(value) : null);
}

export interface CalcParams {
  taxBps: number;
  fixedCostPerSaleCents: number;
}

export async function getCalcParams(): Promise<CalcParams> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ['tax_bps', 'fixed_cost_cents'] } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const tax = Number(m.get('tax_bps'));
  const fixed = Number(m.get('fixed_cost_cents'));
  return {
    taxBps: Number.isInteger(tax) && tax >= 0 ? tax : DEFAULT_TAX_BPS,
    fixedCostPerSaleCents: Number.isInteger(fixed) && fixed >= 0 ? fixed : 0,
  };
}

export interface CapiConfig {
  pixelId: string;
  token: string;
  testCode: string | null;
}

export async function getCapiConfig(): Promise<CapiConfig | null> {
  const pixelId = await getSetting('capi_pixel_id');
  const token = await getSecretSetting('capi_token');
  if (!pixelId || !token) return null;
  return { pixelId, token, testCode: (await getSetting('capi_test_code')) || null };
}
