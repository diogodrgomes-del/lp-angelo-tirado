import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { syncMeta } from '@/lib/sync';

export const maxDuration = 60;

/** Botão "Atualizar": relê os últimos 3 dias de gasto. */
export async function POST() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
  }
  const r = await syncMeta(3);
  return NextResponse.json(r);
}
