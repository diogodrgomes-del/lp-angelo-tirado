import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/config';
import { allowedEmails, verifySession } from '@/lib/session';

/**
 * Tudo exige login, menos: a tela de login, a rota de login, os webhooks
 * (autenticados por segredo próprio) e o cron (autenticado por CRON_SECRET).
 */
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/webhooks\//, /^\/api\/cron\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  // e-mail removido de AUTH_USERS perde o acesso na hora, mesmo com cookie válido
  if (session && allowedEmails().has(session.email)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const res = NextResponse.redirect(url);
  if (session) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
