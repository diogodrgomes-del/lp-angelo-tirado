import { kiwify } from './kiwify';
import { wiapy } from './wiapy';
import type { CheckoutProvider } from './types';

export const ALL_PROVIDERS: Record<string, CheckoutProvider> = { kiwify, wiapy };

/**
 * Só existe endpoint para a plataforma em uso. Cada endpoint ativo é uma URL
 * pública de endereço adivinhável; plataforma sem uso é porta aberta à toa.
 * CHECKOUT_PLATFORMS="wiapy" ou "kiwify" ou "wiapy,kiwify".
 */
export function enabledPlatformIds(raw = process.env.CHECKOUT_PLATFORMS): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s in ALL_PROVIDERS);
}

export function getEnabledProvider(id: string, raw?: string): CheckoutProvider | null {
  return enabledPlatformIds(raw).includes(id) ? ALL_PROVIDERS[id] : null;
}

export type { CheckoutProvider } from './types';
