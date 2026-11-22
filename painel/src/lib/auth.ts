import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE } from '@/config';
import { allowedEmails, verifySession } from './session';
import { prisma } from './db';

/** Confere a sessão dentro de server actions e rotas (o middleware já barra, isto é a segunda tranca). */
export async function requireSession(): Promise<string> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s || !allowedEmails().has(s.email)) throw new Error('não autenticado');
  return s.email;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'desconhecido').trim().slice(0, 64);
}

export const LOGIN_LIMIT = 8;
export const LOGIN_WINDOW_MS = 15 * 60_000;

/** A URL é pública: 8 tentativas erradas por IP a cada 15 minutos. */
export async function loginBlocked(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const fails = await prisma.loginAttempt.count({ where: { ip, ok: false, at: { gte: since } } });
  return fails >= LOGIN_LIMIT;
}

export async function recordLogin(ip: string, ok: boolean): Promise<void> {
  await prisma.loginAttempt.create({ data: { ip, ok } });
  // limpeza oportunista
  if (Math.random() < 0.05) {
    await prisma.loginAttempt.deleteMany({ where: { at: { lt: new Date(Date.now() - 24 * 3600_000) } } });
  }
}
