import { describe, expect, it } from 'vitest';
import { amountToCents, decimalStringToCents, formatBRL, parseBRL } from '@/lib/money';
import { addDays, dayKey, parseLocalDateTime, periodRange, startOfDay } from '@/lib/dates';

describe('dinheiro', () => {
  it('converte decimal sem erro de float', () => {
    expect(decimalStringToCents('0.29')).toBe(29);
    expect(decimalStringToCents('17.9')).toBe(1790);
    expect(decimalStringToCents('123.45')).toBe(12345);
    expect(decimalStringToCents('-0.11')).toBe(-11);
    expect(decimalStringToCents('10.005')).toBe(1001);
    expect(() => decimalStringToCents('1e2')).toThrow();
  });

  it('unidade declarada: 1790 em centavos e 17.90 em decimal são o mesmo valor', () => {
    expect(amountToCents(1790, 'cents')).toBe(1790);
    expect(amountToCents('1790', 'cents')).toBe(1790);
    expect(amountToCents(17.9, 'decimal')).toBe(1790);
    expect(amountToCents('17.90', 'decimal')).toBe(1790);
  });

  it('recusa decimal quando a unidade é centavos (evita número 100× fora)', () => {
    expect(() => amountToCents(17.9, 'cents')).toThrow();
    expect(() => amountToCents(undefined, 'cents')).toThrow();
  });

  it('preserva o sinal do líquido', () => {
    expect(amountToCents(-11, 'cents')).toBe(-11);
    expect(amountToCents(-0.11, 'decimal')).toBe(-11);
  });

  it('lê formato brasileiro (Number("27,90") é NaN)', () => {
    expect(Number('27,90')).toBeNaN();
    expect(parseBRL('27,90')).toBe(2790);
    expect(parseBRL('1.234,56')).toBe(123456);
    expect(parseBRL('R$ 1.234,56')).toBe(123456);
    expect(parseBRL('R$ 97,00')).toBe(9700);
    expect(parseBRL('-0,11')).toBe(-11);
    expect(parseBRL('R$ -2,11')).toBe(-211);
    expect(parseBRL('17.90')).toBe(1790);
    expect(parseBRL('1.234')).toBe(123400);
    expect(parseBRL('1.234.567')).toBe(123456700);
    expect(parseBRL(27.9)).toBe(2790);
    expect(() => parseBRL('abc')).toThrow();
    expect(() => parseBRL('')).toThrow();
  });

  it('formata em reais', () => {
    expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
  });
});

describe('datas em Brasília', () => {
  it('21h de Brasília continua no mesmo dia (não vira o dia seguinte em UTC)', () => {
    const d = parseLocalDateTime('2026-03-10 21:30')!;
    expect(d.toISOString()).toBe('2026-03-11T00:30:00.000Z');
    expect(dayKey(d)).toBe('2026-03-10');
  });

  it('aceita formato brasileiro e respeita fuso explícito', () => {
    expect(parseLocalDateTime('10/03/2026 21:30:15')!.toISOString()).toBe('2026-03-11T00:30:15.000Z');
    expect(parseLocalDateTime('10/03/2026')!.toISOString()).toBe('2026-03-10T03:00:00.000Z');
    expect(parseLocalDateTime('2026-03-10T21:30:00Z')!.toISOString()).toBe('2026-03-10T21:30:00.000Z');
    expect(parseLocalDateTime('2026-03-10T21:30:00-03:00')!.toISOString()).toBe('2026-03-11T00:30:00.000Z');
    expect(parseLocalDateTime('31/02/2026')).toBeNull();
    expect(parseLocalDateTime('lixo')).toBeNull();
    expect(parseLocalDateTime(1767225600)!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('períodos', () => {
    const now = new Date('2026-11-22T02:00:00Z'); // 21/11 23h em Brasília
    const hoje = periodRange('hoje', now);
    expect(hoje.fromDay).toBe('2026-11-21');
    expect(hoje.from.toISOString()).toBe('2026-11-21T03:00:00.000Z');
    expect(hoje.to.toISOString()).toBe('2026-11-22T03:00:00.000Z');
    expect(periodRange('ontem', now).fromDay).toBe('2026-11-20');
    expect(periodRange('7d', now).fromDay).toBe('2026-11-15');
    expect(periodRange('mes', now).fromDay).toBe('2026-11-01');
    const mp = periodRange('mes_passado', now);
    expect([mp.fromDay, mp.toDay]).toEqual(['2026-10-01', '2026-10-31']);
    const jan = periodRange('mes_passado', new Date('2026-01-15T12:00:00Z'));
    expect([jan.fromDay, jan.toDay]).toEqual(['2025-12-01', '2025-12-31']);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(startOfDay('2026-01-01').toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });
});
