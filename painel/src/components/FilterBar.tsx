'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Info } from './ui';

export interface Option {
  value: string;
  label: string;
}

export interface FilterOptions {
  accounts: Option[];
  sources: Option[];
  platforms: Option[];
  products: Option[];
  mediums: Option[];
  campaigns: Option[];
}

const PERIODS: Option[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '14d', label: 'Últimos 14 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: 'max', label: 'Máximo' },
];

const METHODS: Option[] = [
  { value: 'card', label: 'Cartão' },
  { value: 'pix', label: 'Pix' },
  { value: 'boleto', label: 'Boleto' },
];

const STATUSES: Option[] = [
  { value: 'approved', label: 'Aprovada' },
  { value: 'pending', label: 'Pendente' },
  { value: 'refused', label: 'Recusada' },
  { value: 'refunded', label: 'Reembolsada' },
  { value: 'chargeback', label: 'Chargeback' },
  { value: 'canceled', label: 'Cancelada' },
];

function Select({
  label,
  name,
  options,
  value,
  onChange,
  any = 'Qualquer',
  info,
}: {
  label: string;
  name: string;
  options: Option[];
  value: string;
  onChange: (name: string, v: string) => void;
  any?: string | null;
  info?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="rotulo flex items-center gap-2">
        {label}
        {info && <Info text={info} />}
      </span>
      <select
        className="campo mt-2.5 truncate"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        aria-label={label}
      >
        {any !== null && <option value="">{any}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FilterBar({
  title,
  options,
  updatedAt,
  showStatus = false,
}: {
  title: string;
  options: FilterOptions;
  updatedAt?: string | null;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const moreActive = !!(sp.get('method') || sp.get('medium') || sp.get('campaign'));
  const [more, setMore] = useState(moreActive);

  const v = (k: string) => sp.get(k) ?? '';
  function set(name: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value && !(name === 'period' && value === 'hoje')) next.set(name, value);
    else next.delete(name);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${path}?${qs}` : path, { scroll: false }));
  }

  async function refresh() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
      if (body.errors?.length) setSyncMsg(body.errors[0]);
    } catch {
      setSyncMsg('Falha de rede ao atualizar.');
    }
    setSyncing(false);
    startTransition(() => router.refresh());
  }

  return (
    <section className="cartao" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-borda px-7 py-5">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex items-center gap-5">
          {updatedAt && <span className="hidden text-[15px] text-suave sm:inline">Atualizado {updatedAt}</span>}
          <button className="botao" onClick={refresh} disabled={syncing}>
            {syncing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      {syncMsg && <p className="border-b border-borda px-7 py-3 text-sm text-vermelho">{syncMsg}</p>}
      <div className="grid grid-cols-1 gap-5 px-7 py-6 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          label="Período de Visualização"
          name="period"
          options={PERIODS}
          value={v('period') || 'hoje'}
          onChange={set}
          any={null}
          info="Faturamento conta pela data de PAGAMENTO; vendas pendentes, pela data do PEDIDO. Dias no horário de Brasília."
        />
        <Select label="Conta de Anúncio" name="account" options={options.accounts} value={v('account')} onChange={set} />
        <Select label="Fonte de Tráfego" name="source" options={options.sources} value={v('source')} onChange={set} />
        <Select label="Plataforma" name="platform" options={options.platforms} value={v('platform')} onChange={set} />
        <Select label="Produto" name="product" options={options.products} value={v('product')} onChange={set} />
      </div>
      {more && (
        <div className="grid grid-cols-1 gap-5 border-t border-borda px-7 py-6 sm:grid-cols-2 lg:grid-cols-5">
          <Select label="Método de Pagamento" name="method" options={METHODS} value={v('method')} onChange={set} />
          <Select label="utm_medium" name="medium" options={options.mediums} value={v('medium')} onChange={set} />
          <Select label="utm_campaign" name="campaign" options={options.campaigns} value={v('campaign')} onChange={set} />
          {showStatus && <Select label="Status" name="status" options={STATUSES} value={v('status')} onChange={set} />}
        </div>
      )}
      <div className="flex justify-end border-t border-borda px-7 py-4">
        <button className="text-[15px] text-texto/90 hover:text-texto" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? 'Menos filtros ▴' : 'Mais filtros ▾'}
        </button>
      </div>
    </section>
  );
}
