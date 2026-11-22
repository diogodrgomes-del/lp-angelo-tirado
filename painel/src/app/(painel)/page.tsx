import Link from 'next/link';
import { after } from 'next/server';
import { prisma } from '@/lib/db';
import { parseFilters } from '@/lib/filters';
import { loadFilterOptions, loadSummary } from '@/lib/queries';
import { formatBRL, formatPercent, formatRatio } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { isMetaStale, META_ID, syncMeta } from '@/lib/sync';
import { healthWarnings } from '@/lib/health';
import FilterBar from '@/components/FilterBar';
import DailyChart from '@/components/DailyChart';
import { Info, MetricCard } from '@/components/ui';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ResumoPage({ searchParams }: { searchParams: SP }) {
  const f = parseFilters(await searchParams);
  const [{ summary: s, params }, options, meta, accounts, warnings] = await Promise.all([
    loadSummary(f),
    loadFilterOptions(),
    prisma.integration.findUnique({ where: { id: META_ID } }),
    prisma.adAccount.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    healthWarnings(),
  ]);

  // gasto "em tempo real": se o último sync tem mais de 15 min, atualiza em segundo plano
  if (await isMetaStale(15)) after(() => syncMeta(3).catch(() => undefined));

  const tax = (params.taxBps / 100).toLocaleString('pt-BR');

  return (
    <div className="space-y-6">
      <FilterBar title="Resumo" options={options} updatedAt={meta?.lastSyncAt ? formatDateTime(meta.lastSyncAt) : null} />

      {warnings.length > 0 && (
        <section className="cartao divide-y divide-borda" aria-label="Avisos">
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-3 px-7 py-3.5 text-sm">
              <span className={w.level === 'erro' ? 'text-vermelho' : 'text-amarelo'} aria-hidden>
                {w.level === 'erro' ? '●' : '▲'}
              </span>
              <span className="flex-1 text-texto/90">
                <span className="sr-only">{w.level === 'erro' ? 'Erro: ' : 'Aviso: '}</span>
                {w.text}
              </span>
              {w.href && (
                <Link href={w.href} className="shrink-0 text-destaque hover:underline">
                  Resolver
                </Link>
              )}
            </p>
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Faturamento Líquido"
          value={formatBRL(s.netRevenueCents)}
          sub={`${s.approvedCount} venda(s) aprovada(s)`}
          info="Soma do valor líquido (o que fica com você) das vendas aprovadas, pela data de PAGAMENTO."
          tone={s.netRevenueCents < 0 ? 'ruim' : undefined}
        />
        <MetricCard
          title="Gastos com anúncios"
          value={formatBRL(s.spendCents)}
          info="Gasto diário por campanha vindo da API da Meta, só das contas marcadas em Integrações."
        />
        <MetricCard title="ROAS" value={formatRatio(s.roas)} info="Faturamento líquido ÷ gasto com anúncios." />
        <MetricCard
          title="Imposto Meta Ads"
          value={formatBRL(s.adTaxCents)}
          info={`Gasto × ${tax}% (CIDE, PIS/COFINS e ISS sobre mídia comprada no exterior). Ajustável em Integrações.`}
        />

        <MetricCard
          title="Lucro"
          value={formatBRL(s.profitCents)}
          sub="Líquido − mídia − imposto − custo do produto"
          info="Faturamento líquido − gasto − imposto sobre anúncios − custo do produto − custo fixo por venda."
          tone={s.profitCents < 0 ? 'ruim' : undefined}
        />
        <MetricCard
          title="Vendas Pendentes"
          value={formatBRL(s.pendingCents)}
          sub={`${s.pendingCount} pedido(s) aguardando`}
          info="Pix e boletos gerados e ainda não pagos, pela data do PEDIDO."
        />
        <MetricCard title="ROI" value={formatRatio(s.roi)} info="Lucro ÷ (gasto + imposto sobre anúncios)." tone={s.roi !== null && s.roi < 0 ? 'ruim' : undefined} />
        <div className="cartao p-7">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold">Taxa de Aprovação</h3>
            <Info text="Aprovadas ÷ todas as tentativas (inclusive pendentes) dos pedidos criados no período. Sem os pendentes, pix e boleto apareceriam perto de 100%." />
          </div>
          <ul className="mt-5 space-y-5">
            {(
              [
                ['card', 'Cartão'],
                ['pix', 'Pix'],
                ['boleto', 'Boleto'],
              ] as const
            ).map(([k, label]) => {
              const m = s.approval[k];
              const pct = m.rate ?? 0;
              const C = 2 * Math.PI * 14;
              return (
                <li key={k} className="flex items-center justify-between gap-3">
                  <span className="text-[15px]">{label}</span>
                  <span className="flex items-center gap-4">
                    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
                      <circle cx="17" cy="17" r="14" fill="none" stroke="#222d47" strokeWidth="3.5" />
                      {m.rate !== null && (
                        <circle
                          cx="17"
                          cy="17"
                          r="14"
                          fill="none"
                          stroke="var(--serie-faturamento)"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeDasharray={`${C * pct} ${C}`}
                          transform="rotate(-90 17 17)"
                        />
                      )}
                    </svg>
                    <span className="w-14 text-right text-[15px]" title={`${m.approved} de ${m.total}`}>
                      {formatPercent(m.rate, 0)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <MetricCard
          title="Vendas Reembolsadas"
          value={formatBRL(s.refundedCents)}
          sub={`${s.refundedCount} reembolso(s)`}
          info="Valor líquido das vendas reembolsadas, pela data do reembolso."
        />
        <MetricCard
          title="Chargeback"
          value={formatPercent(s.chargebackRate)}
          sub={`${s.chargebackCount} contestação(ões)`}
          info="Contestações ÷ (aprovadas + contestações) das vendas pagas no período."
        />
        <MetricCard
          title="Custo do Produto"
          value={formatBRL(s.productCostCents + s.fixedCostCents)}
          info="Custo unitário de cada produto × vendas aprovadas + custo fixo por venda. Configure em Integrações."
        />
        <div className="cartao p-7">
          {accounts.length === 0 ? (
            <>
              <h3 className="text-[15px] text-texto/90">Saldo</h3>
              <p className="mt-3 text-sm text-suave">Nenhuma conta de anúncio marcada.</p>
            </>
          ) : (
            accounts.map((a) => (
              <div key={a.id} className="[&+&]:mt-4">
                <h3 className="text-[15px] text-texto/90">Saldo · {a.name}</h3>
                {a.lastError || (meta?.status === 'error' && meta.lastError) ? (
                  <p className="mt-3 break-words text-sm text-vermelho">{a.lastError ?? meta?.lastError}</p>
                ) : (
                  <p className="mt-4 text-[28px] font-semibold leading-none">
                    {a.balanceCents === null ? '—' : formatBRL(a.balanceCents)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
        <MetricCard
          title="Ticket Médio"
          value={formatBRL(s.avgTicketCents)}
          info="Faturamento líquido ÷ número de vendas aprovadas."
        />
      </div>

      <section className="cartao p-7">
        <h2 className="mb-4 text-lg font-semibold">Faturamento x Gasto x Lucro</h2>
        <DailyChart data={s.daily} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Breakdown
          title="Vendas por Produto"
          info="Vendas aprovadas no período, por produto."
          rows={s.byProduct.map((p) => ({ label: p.name, count: p.count, net: p.netCents }))}
        />
        <Breakdown
          title="Vendas por Fonte"
          info="Vendas aprovadas por fonte de tráfego (utm_source; com fbclid e sem utm conta como Meta)."
          rows={s.bySource.map((p) => ({ label: p.source, count: p.count, net: p.netCents }))}
        />
      </div>
    </div>
  );
}

function Breakdown({ title, info, rows }: { title: string; info: string; rows: { label: string; count: number; net: number }[] }) {
  const total = rows.reduce((t, r) => t + Math.max(0, r.net), 0);
  return (
    <section className="cartao p-7">
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Info text={info} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-8 pb-4 text-[15px] text-suave">Nenhuma venda por aqui</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 text-suave">
                  {r.count} · <span className="text-texto">{formatBRL(r.net)}</span>
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded bg-borda">
                <div
                  className="h-1.5 rounded"
                  style={{ width: `${total ? Math.max(2, (Math.max(0, r.net) / total) * 100) : 0}%`, background: 'var(--serie-faturamento)' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

