import { NextResponse, after } from 'next/server';
import { receiveWebhook, MAX_BODY_BYTES } from '@/lib/webhook';
import { flushCapi } from '@/lib/sales';

export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return NextResponse.json({ error: 'payload grande demais' }, { status: 413 });
  const rawBody = await req.text();
  const out = await receiveWebhook(platform, { rawBody, headers: req.headers, url: new URL(req.url) });
  // Conversions API depois de responder: a plataforma não espera a Meta
  if (out.approvedSaleIds.length) after(() => flushCapi(out.approvedSaleIds).catch(() => undefined));
  return NextResponse.json(out.body, { status: out.status });
}

// alguns checkouts testam a URL com GET antes de salvar
export async function GET(_: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const { getEnabledProvider } = await import('@/lib/providers');
  return getEnabledProvider(platform)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'not found' }, { status: 404 });
}
