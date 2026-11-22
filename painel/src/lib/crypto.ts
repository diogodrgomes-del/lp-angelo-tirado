import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Credenciais de integração cifradas com AES-256-GCM.
 * ENCRYPTION_KEY: 32 bytes em base64 (npm run gen-key).
 * A chave NÃO pode mudar depois que uma integração for conectada: o que foi
 * cifrado com a chave antiga deixa de abrir. keyFingerprint() permite detectar.
 */

function loadKey(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error('ENCRYPTION_KEY não configurada');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY precisa ter 32 bytes em base64 (npm run gen-key)');
  return key;
}

export function encrypt(plain: string, rawKey?: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(blob: string, rawKey?: string): string {
  const key = loadKey(rawKey);
  const [v, ivB, tagB, ctB] = blob.split(':');
  if (v !== 'v1' || !ivB || !tagB || ctB === undefined) throw new Error('Formato cifrado desconhecido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Não foi possível decifrar a credencial: a ENCRYPTION_KEY mudou depois que a integração foi conectada.',
    );
  }
}

/** Identificador curto da chave, para detectar troca acidental. Não revela a chave. */
export function keyFingerprint(rawKey?: string): string {
  return createHash('sha256').update(loadKey(rawKey)).digest('hex').slice(0, 16);
}
