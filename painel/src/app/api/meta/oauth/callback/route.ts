import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/meta';
import { connectMeta, syncMeta } from '@/lib/sync';

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  const url = new URL(req.url);
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/integracoes?meta=${q}`, req.url));
    r.cookies.delete('meta_oauth_state');
    return r;
  };
  const state = url.searchParams.get('state');
  const cookieState = req.headers.get('cookie')?.match(/(?:^|;\s*)meta_oauth_state=([a-f0-9]+)/)?.[1];
  if (!state || !cookieState || state !== cookieState) return back('estado_invalido');
  const code = url.searchParams.get('code');
  if (!code) return back('cancelado');
  try {
    const { token, expiresAt } = await exchangeCode(
      process.env.META_APP_ID!,
      process.env.META_APP_SECRET!,
      new URL('/api/meta/oauth/callback', req.url).toString(),
      code,
    );
    const r = await connectMeta(token, 'user', expiresAt);
    if (r.active) await syncMeta(90);
    return back('ok');
  } catch (e) {
    return back(`erro&detalhe=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
