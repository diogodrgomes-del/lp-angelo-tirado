import { parseFilters } from '@/lib/filters';
import { loadFilterOptions, loadSales } from '@/lib/queries';
import { formatBRL } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { ALL_PROVIDERS } from '@/lib/providers';
import FilterBar from '@/components/FilterBar';
import { Empty, METHOD_LABEL, StatusPill } from '@/components/ui';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function VendasPage({ searchParams }: { searchParams: SP }) {
  const f = parseFilters(await searchParams);
  const [{ sales }, options] = await Promise.all([loadSales(f), loadFilterOptions()]);

  return (
    <div className="space-y-6">
      <FilterBar title="Vendas" options={options} showStatus />
      <h2 className="text-xl font-semibold">
        Vendas <span className="text-base font-normal text-suave">({sales.length} no período)</span>
      </h2>
      <div className="cartao overflow-x-auto">
        <table className="tabela w-full">
          <thead>
            <tr>
              <th>Data</th>
              <th>Produto</th>
              <th>Cliente</th>
              <th>Método</th>
              <th>Fonte</th>
              <th>Campanha</th>
              <th>Status</th>
              <th className="text-right">Bruto</th>
              <th className="text-right">Líquido</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="hover:bg-cartao2/60">
                <td title={`Pedido ${formatDateTime(s.orderedAt)}${s.paidAt ? ` · pago ${formatDateTime(s.paidAt)}` : ''}`}>
                  {formatDateTime(s.paidAt ?? s.orderedAt)}
                </td>
                <td className="max-w-[220px] truncate" title={s.productName}>
                  {s.productName}
                  <span className="block text-xs text-suave">{ALL_PROVIDERS[s.platform]?.label ?? s.platform}</span>
                </td>
                <td className="max-w-[200px] truncate" title={s.customerEmail ?? ''}>
                  {s.customerName ?? '—'}
                  <span className="block text-xs text-suave">{s.customerEmail}</span>
                </td>
                <td>{METHOD_LABEL[s.paymentMethod] ?? s.paymentMethod}</td>
                <td>{s.source}</td>
                <td className="max-w-[220px] truncate" title={s.utmCampaign ?? ''}>
                  {s.campaignName ?? <span className="text-suave">—</span>}
                </td>
                <td>
                  <StatusPill status={s.status} />
                </td>
                <td className="text-right">{formatBRL(s.grossCents)}</td>
                <td className={`text-right ${s.netCents < 0 ? 'text-vermelho' : ''}`}>{formatBRL(s.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sales.length === 0 && <Empty>Nenhuma venda no período</Empty>}
      </div>
    </div>
  );
}
