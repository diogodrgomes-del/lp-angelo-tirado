/** Peças visuais pequenas, sem estado. */

export function Info({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label={text}
        className="inline-flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full border border-suave/70 text-[11px] leading-none text-suave"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-6 z-20 hidden w-64 rounded-lg border border-borda bg-cartao2 p-3 text-xs font-normal leading-relaxed text-texto shadow-xl group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}

export function MetricCard({
  title,
  value,
  sub,
  info,
  tone,
}: {
  title: string;
  value: string;
  sub?: string;
  info?: string;
  tone?: 'bom' | 'ruim';
}) {
  return (
    <div className="cartao p-7">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] text-texto/90">{title}</h3>
        {info && <Info text={info} />}
      </div>
      <p
        className={`mt-4 text-[28px] font-semibold leading-none tracking-tight ${
          tone === 'ruim' ? 'text-vermelho' : 'text-texto'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-3 text-sm text-suave">{sub}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-14 text-center text-[15px] text-suave">{children}</p>;
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    approved: ['Aprovada', 'text-verde'],
    pending: ['Pendente', 'text-amarelo'],
    refused: ['Recusada', 'text-vermelho'],
    refunded: ['Reembolsada', 'text-suave'],
    chargeback: ['Chargeback', 'text-vermelho'],
    canceled: ['Cancelada', 'text-suave'],
  };
  const [label, cls] = map[status] ?? [status, 'text-suave'];
  return <span className={cls}>{label}</span>;
}

export const METHOD_LABEL: Record<string, string> = { card: 'Cartão', pix: 'Pix', boleto: 'Boleto', other: 'Outro' };
