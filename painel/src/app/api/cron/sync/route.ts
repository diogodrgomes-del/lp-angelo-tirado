import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { syncMeta } from '@/lib/sync';
import { flushCapi } from '@/lib/sales';

export const maxDuration = 60;

/** Cron diário da Vercel (plano Hobby aceita 1 por dia). Autenticado por CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }
  const sync = await syncMeta(7);
  const capi = await flushCapi();
  return NextResponse.json({ sync, capi });
}
