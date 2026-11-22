import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/config';
import { checkCredentials, loadUsers } from '@/lib/password';
import { signSession } from '@/lib/session';
import { clientIp, loginBlocked, recordLogin } from '@/lib/auth';

export async function POST(req: Request) {
  const ip = await clientIp();
  if (await loginBlocked(ip)) {
    return NextResponse.json({ error: 'Muitas tentativas. Espere 15 minutos.' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email.slice(0, 200) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 500) : '';
  const users = loadUsers();
  const ok = email && password ? await checkCredentials(email, password, users) : null;
  if (!ok) {
    // diagnóstico sem segredos: quantos usuários o servidor enxerga e se o e-mail existe
    const raw = process.env.AUTH_USERS ?? '';
    console.warn(
      `[login] recusado: usuarios=${users.length} auth_users_len=${raw.length} ` +
        `email_conhecido=${users.some((u) => u.email === email.trim().toLowerCase())} ` +
        `formato=${users[0]?.hash.slice(0, 7) ?? '-'} senha_len=${password.length}`,
    );
  }
  await recordLogin(ip, !!ok);
  if (!ok) return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });

  const token = await signSession({ email: ok, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
