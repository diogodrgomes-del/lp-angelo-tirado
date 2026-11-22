import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireSession } from '@/lib/auth';
import { oauthUrl } from '@/lib/meta';

/** Login com Facebook (opcional: só com META_APP_ID e META_APP_SECRET configurados). */
export async function GET(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  const appId = process.env.META_APP_ID;
  if (!appId || !process.env.META_APP_SECRET) {
    return NextResponse.redirect(new URL('/integracoes?meta=sem_app', req.url));
  }
  const state = randomBytes(16).toString('hex');
  const redirect = new URL('/api/meta/oauth/callback', req.url).toString();
  const res = NextResponse.redirect(oauthUrl(appId, redirect, state));
  res.cookies.set('meta_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
