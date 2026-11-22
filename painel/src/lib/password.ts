import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * Senhas com scrypt. Formato: scrypt:N:r:p:salt(base64):hash(base64)
 * Separador ":" e não "$": no build da Vercel/Next.js, "$algo" dentro de uma
 * variável de ambiente pode ser tratado como referência a outra variável e
 * apagado — o hash corrompido recusa todo login. O formato antigo com "$"
 * continua aceito.
 * Contas ficam em AUTH_USERS (variável de ambiente, JSON):
 *   [{"email":"a@b.com","hash":"scrypt:..."}]
 * Nunca no banco: restaurar um backup não pode trazer de volta um acesso removido.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEYLEN, { N: n, r, p, maxmem: 256 * n * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split(stored.includes(':') ? ':' : '$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB, hashB] = parts;
  const expected = Buffer.from(hashB, 'base64');
  const got = await scrypt(password, Buffer.from(saltB, 'base64'), Number(n), Number(r), Number(p));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export interface AuthUser {
  email: string;
  hash: string;
}

/** Tolera o que costuma vir junto ao colar: aspas curvas, crases, espaços. */
export function normalizeUsersJson(raw: string): string {
  return raw
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

export function loadUsers(raw = process.env.AUTH_USERS): AuthUser[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(normalizeUsersJson(raw));
    if (!Array.isArray(list)) return [];
    return list
      .filter((u) => u && typeof u.email === 'string' && typeof u.hash === 'string')
      .map((u) => ({ email: u.email.trim().toLowerCase(), hash: u.hash }));
  } catch {
    return [];
  }
}

/** Hash fixo para gastar o mesmo tempo quando o e-mail não existe. */
const DUMMY = ['scrypt', N, R, P, Buffer.alloc(16).toString('base64'), Buffer.alloc(64).toString('base64')].join(':');

export async function checkCredentials(
  email: string,
  password: string,
  users = loadUsers(),
): Promise<string | null> {
  const e = email.trim().toLowerCase();
  const user = users.find((u) => u.email === e);
  const ok = await verifyPassword(password, user?.hash ?? DUMMY);
  return ok && user ? user.email : null;
}
