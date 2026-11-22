'use client';

import { useMemo, useState } from 'react';

/**
 * Faturamento x Gasto x Lucro por dia. Três séries na MESMA unidade (R$),
 * então um eixo só. Cores validadas para daltonismo no fundo escuro.
 * Hover: linha vertical + tooltip com os três valores do dia.
 */

export interface Point {
  day: string;
  netCents: number;
  spendCents: number;
  profitCents: number;
}

const SERIES = [
  { key: 'netCents', label: 'Faturamento', color: 'var(--serie-faturamento)' },
  { key: 'spendCents', label: 'Gasto', color: 'var(--serie-gasto)' },
  { key: 'profitCents', label: 'Lucro', color: 'var(--serie-lucro)' },
] as const;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v));
  return out;
}

export default function DailyChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 260;
  const pad = { l: 64, r: 16, t: 12, b: 28 };

  const { ticks, y, x } = useMemo(() => {
    const vals = data.flatMap((d) => [d.netCents, d.spendCents, d.profitCents]);
    const t = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
    const lo = t[0];
    const hi = t[t.length - 1];
    return {
      ticks: t,
      y: (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1)),
      x: (i: number) => pad.l + (data.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (data.length - 1)),
    };
  }, [data, pad.b, pad.l, pad.r, pad.t]);

  const hasData = data.some((d) => d.netCents || d.spendCents);
  if (!hasData) return <p className="py-20 text-center text-[15px] text-suave">Sem movimento no período selecionado</p>;

  const labelEvery = Math.max(1, Math.ceil(data.length / 10));
  const fmtDay = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-5 text-sm text-suave" aria-label="Legenda">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Faturamento, gasto e lucro por dia"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const step = data.length > 1 ? (W - pad.l - pad.r) / (data.length - 1) : 1;
            const i = Math.round((px - pad.l) / step);
            setHover(Math.max(0, Math.min(data.length - 1, i)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#222d47" strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#8a96b0">
                {compact.format(t / 100)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            // a última data sempre aparece; a regular que encostaria nela é pulada
            i === data.length - 1 || (i % labelEvery === 0 && data.length - 1 - i >= labelEvery / 2) ? (
              <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="#8a96b0">
                {fmtDay(d.day)}
              </text>
            ) : null,
          )}
          {SERIES.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')}
            />
          ))}
          {data.length === 1 &&
            SERIES.map((s) => <circle key={s.key} cx={x(0)} cy={y(data[0][s.key])} r={5} fill={s.color} stroke="#151e33" strokeWidth={2} />)}
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#8a96b0" strokeDasharray="3 3" />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(h[s.key])} r={4.5} fill={s.color} stroke="#151e33" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[190px] rounded-lg border border-borda bg-cartao2 p-3 text-sm shadow-xl"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: hover > data.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <p className="mb-1.5 font-medium">{fmtDay(h.day)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-suave">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="text-texto">{brl.format(h[s.key] / 100)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="mt-3 text-sm text-suave">
        <summary className="cursor-pointer">Ver em tabela</summary>
        <table className="tabela mt-2 w-full">
          <thead>
            <tr>
              <th>Dia</th>
              <th className="text-right">Faturamento</th>
              <th className="text-right">Gasto</th>
              <th className="text-right">Lucro</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{fmtDay(d.day)}</td>
                <td className="text-right text-texto">{brl.format(d.netCents / 100)}</td>
                <td className="text-right text-texto">{brl.format(d.spendCents / 100)}</td>
                <td className="text-right text-texto">{brl.format(d.profitCents / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
