import { parseFilters } from '@/lib/filters';
import { loadCampaigns, loadFilterOptions } from '@/lib/queries';
import { formatBRL, formatInt, formatRatio } from '@/lib/money';
import FilterBar from '@/components/FilterBar';
import { Empty } from '@/components/ui';

type SP = Promise<Record<string, string | string[] | undefined>>;

const STATUS: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  CAMPAIGN_PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
  DELETED: 'Excluída',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
};

export default async function CampanhasPage({ searchParams }: { searchParams: SP }) {
  const f = parseFilters(await searchParams);
  const [{ rows, unattributed }, options] = await Promise.all([loadCampaigns(f), loadFilterOptions()]);

  return (
    <div className="space-y-6">
      <FilterBar title="Campanhas" options={options} />
      <div className="cartao overflow-x-auto">
        <table className="tabela w-full">
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Conta</th>
              <th>Status</th>
              <th className="text-right">Impressões</th>
              <th className="text-right">Cliques</th>
              <th className="text-right">Gasto</th>
              <th className="text-right">Vendas</th>
              <th className="text-right">Faturamento</th>
              <th className="text-right">CPA</th>
              <th className="text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-cartao2/60">
                <td className="max-w-[300px] truncate" title={`${r.name} (${r.id})`}>
                  {r.name}
                </td>
                <td className="max-w-[180px] truncate">{r.account}</td>
                <td className={r.status === 'ACTIVE' ? 'text-verde' : 'text-suave'}>
                  {r.status ? (STATUS[r.status] ?? r.status) : '—'}
                </td>
                <td className="text-right">{formatInt(r.impressions)}</td>
                <td className="text-right">{formatInt(r.clicks)}</td>
                <td className="text-right">{formatBRL(r.spendCents)}</td>
                <td className="text-right">{r.sales}</td>
                <td className="text-right">{formatBRL(r.revenueCents)}</td>
                <td className="text-right">{r.cpaCents === null ? 'N/A' : formatBRL(r.cpaCents)}</td>
                <td className="text-right">{formatRatio(r.roas)}</td>
              </tr>
            ))}
            {unattributed.count > 0 && (
              <tr className="text-suave">
                <td colSpan={6} title="Vendas aprovadas sem utm_campaign que case com uma campanha das contas marcadas">
                  Sem campanha identificada
                </td>
                <td className="text-right">{unattributed.count}</td>
                <td className="text-right">{formatBRL(unattributed.net)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 0 && unattributed.count === 0 && <Empty>Nenhuma campanha com movimento no período</Empty>}
      </div>
      <p className="text-sm text-suave">
        Venda é ligada à campanha pelo <code>utm_campaign</code> no formato <code>Nome|ID</code> (ou pelo nome exato). Na Meta,
        use em Parâmetros de URL: <code>utm_source=FB&amp;utm_campaign={'{{campaign.name}}|{{campaign.id}}'}&amp;utm_medium={'{{adset.name}}'}&amp;utm_content={'{{ad.name}}'}</code>
      </p>
    </div>
  );
}
