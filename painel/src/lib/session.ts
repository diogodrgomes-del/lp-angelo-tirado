/**
 * Cookie de sessão assinado (HMAC-SHA256). Usa só Web Crypto para rodar
 * também no middleware (edge). Formato: base64url(json).base64url(assinatura)
 */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function getSecret(secret?: string): string {
  const s = secret ?? process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET ausente ou curta (mínimo 32 caracteres)');
  return s;
}

export interface Session {
  email: string;
  /** expiração, em segundos desde a época */
  exp: number;
}

export async function signSession(session: Session, secret?: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(session)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(getSecret(secret)), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(
  token: string | undefined | null,
  secret?: string,
  now = Date.now(),
): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await hmacKey(getSecret(secret));
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp * 1000 < now) return null;
    return data;
  } catch {
    return null;
  }
}

/** E-mails permitidos, lidos de AUTH_USERS sem depender de node:crypto (edge). */
export function allowedEmails(raw = process.env.AUTH_USERS): Set<string> {
  try {
    const clean = (raw ?? '[]').trim().replace(/^`+|`+$/g, '').replace(/[\u201C\u201D\u201E\u2033]/g, '"');
    const list = JSON.parse(clean);
    return new Set(
      Array.isArray(list) ? list.map((u: { email?: unknown }) => String(u?.email ?? '').trim().toLowerCase()) : [],
    );
  } catch {
    return new Set();
  }
}
