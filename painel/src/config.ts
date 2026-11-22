/** Marca e identificadores. Trocar aqui (ou por variável de ambiente) ao portar. */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Painel';
export const APP_SLUG =
  (process.env.APP_SLUG || 'painel').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'painel';
export const SESSION_COOKIE = `${APP_SLUG}_session`;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 dias
export const TIMEZONE = 'America/Sao_Paulo';
