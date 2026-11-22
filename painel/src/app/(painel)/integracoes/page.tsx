import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { formatBRL } from '@/lib/money';
import { addDays, dayKey, formatDateTime } from '@/lib/dates';
import { ALL_PROVIDERS, enabledPlatformIds } from '@/lib/providers';
import { productKey } from '@/lib/metrics';
import { getCalcParams, getSetting } from '@/lib/settings';
import { META_ID } from '@/lib/sync';
import ActionForm, { Submit } from '@/components/ActionForm';
import CopyField from '@/components/CopyField';
import ImportForm from '@/components/ImportForm';
import {
  disconnectMeta,
  removeInactiveAccounts,
  reprocessWebhooks,
  saveAccountSelection,
  saveCalcParams,
  saveCapi,
  saveMetaToken,
  saveProductCosts,
  saveWebhookSecret,
} from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;

const META_MSG: Record<string, [boolean, string]> = {
  ok: [true, 'Meta Ads conectada.'],
  cancelado: [false, 'Conexão cancelada.'],
  estado_invalido: [false, 'A conexão expirou. Tente de novo.'],
  sem_app: [false, 'Login com Facebook exige META_APP_ID e META_APP_SECRET. Use o token de System User abaixo.'],
  erro: [false, 'Erro ao conectar'],
};

function Card({ title, desc, right, children }: { title: string; desc?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="cartao p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {desc && <div className="mt-1.5 max-w-4xl text-[15px] leading-relaxed text-suave">{desc}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function IntegracoesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const platforms = enabledPlatformIds();
  const since30 = addDays(dayKey(new Date()), -29);

  const [meta, accounts, spend30, integrations, saleCounts, events, products, costs, calc, pixel, testCode, capiToken, capiStats] =
    await Promise.all([
      prisma.integration.findUnique({ where: { id: META_ID } }),
      prisma.adAccount.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      prisma.campaignDaily.findMany({
        where: { date: { gte: since30 } },
        select: { spendCents: true, campaign: { select: { adAccountId: true } } },
      }),
      prisma.integration.findMany({ where: { id: { in: platforms } } }),
      prisma.sale.groupBy({ by: ['platform'], _count: true }),
      prisma.webhookEvent.findMany({
        where: { platform: { in: platforms } },
        orderBy: { receivedAt: 'desc' },
        take: 30,
      }),
      prisma.sale.groupBy({ by: ['platform', 'productId', 'productName'], _count: true }),
      prisma.productCost.findMany(),
      getCalcParams(),
      getSetting('capi_pixel_id'),
      getSetting('capi_test_code'),
      getSetting('capi_token'),
      prisma.sale.aggregate({ where: { capiSentAt: { not: null } }, _count: true, _max: { capiSentAt: true } }),
    ]);
  const capiErrors = await prisma.sale.count({ where: { capiError: { not: null }, capiSentAt: null } });

  const spendByAccount = new Map<string, number>();
  for (const r of spend30) spendByAccount.set(r.campaign.adAccountId, (spendByAccount.get(r.campaign.adAccountId) ?? 0) + r.spendCents);
  const activeCount = accounts.filter((a) => a.active).length;
  const costMap = new Map(costs.map((c) => [c.key, c.costCents]));
  const metaMsg = typeof sp.meta === 'string' ? META_MSG[sp.meta] : undefined;
  const hasOAuth = !!process.env.META_APP_ID && !!process.env.META_APP_SECRET;
  const days = meta?.tokenExpiresAt ? Math.floor((meta.tokenExpiresAt.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Integrações</h1>

      {/* ── Meta Ads ───────────────────────────────────────────── */}
      <Card
        title="Meta Ads"
        desc="Gasto, impressões e cliques por campanha, direto da Marketing API."
        right={
          hasOAuth ? (
            <a href="/api/meta/oauth/start" className="botao">
              {meta?.credentials ? 'Reconectar' : 'Conectar'}
            </a>
          ) : undefined
        }
      >
        {metaMsg && (
          <p className={`mt-4 text-sm ${metaMsg[0] ? 'text-verde' : 'text-vermelho'}`}>
            {metaMsg[1]}
            {typeof sp.detalhe === 'string' ? `: ${sp.detalhe}` : ''}
          </p>
        )}
        <div className="mt-5 border-t border-borda pt-5">
          {meta?.credentials ? (
            <>
              <p className="text-[15px]">
                <span className={meta.status === 'error' ? 'text-vermelho' : 'text-verde'}>
                  {meta.status === 'error' ? 'Com erro' : 'Conectada'}
                </span>
                <span className="text-suave">
                  {' '}
                  · último sync {formatDateTime(meta.lastSyncAt)} ·{' '}
                  {meta.tokenKind === 'system_user'
                    ? 'token de System User (não expira)'
                    : days !== null
                      ? `token de usuário, expira em ${days} dia(s)`
                      : 'token de usuário'}
                </span>
              </p>
              {meta.lastError && <p className="mt-2 whitespace-pre-line break-words text-sm text-vermelho">{meta.lastError}</p>}
              {meta.tokenKind !== 'system_user' && (
                <p className="mt-2 text-sm text-amarelo">
                  Token de usuário expira em ~60 dias e, quando expira, o gasto só congela, sem erro visível. Use um token de System User.
                </p>
              )}
            </>
          ) : (
            <p className="text-[15px] text-suave">Não conectada.</p>
          )}
          <details className="mt-4" open={!meta?.credentials}>
            <summary className="cursor-pointer text-[15px] text-texto/80 hover:text-texto">Usar um token permanente (System User)</summary>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-suave">
              <p>
                Business Manager → Configurações do negócio → Usuários do sistema → Adicionar (função Funcionário basta) → Atribuir ativos: a conta de
                anúncio, permissão &quot;Ver desempenho&quot; → Gerar novo token, com o app e a permissão <code>ads_read</code>, validade
                &quot;Nunca&quot;.
              </p>
            </div>
            <ActionForm action={saveMetaToken} className="mt-4 space-y-3">
              <textarea name="token" rows={2} className="campo font-mono text-sm" placeholder="EAAxxxx…" autoComplete="off" required />
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" value="system_user" defaultChecked /> System User (não expira)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" value="user" /> Token de usuário (~60 dias)
                </label>
              </div>
              <Submit busy="Conectando…">Conectar com token</Submit>
            </ActionForm>
          </details>
          {meta?.credentials && (
            <ActionForm action={disconnectMeta} className="mt-4" confirm="Desconectar a Meta? O histórico de gasto fica guardado.">
              <Submit variant="link" busy="Desconectando…">
                Desconectar
              </Submit>
            </ActionForm>
          )}
        </div>
      </Card>

      {/* ── Contas ─────────────────────────────────────────────── */}
      <Card
        title="Contas de anúncio no painel"
        desc="Só as marcadas entram no gasto, no ROAS e no lucro. Desmarcar não apaga nada — os dados voltam se você marcar de novo. Conta nova entra desmarcada quando o token enxerga mais de uma."
        right={
          <span className="rounded-full border border-borda bg-cartao2 px-3 py-1 text-sm">
            {activeCount} de {accounts.length}
          </span>
        }
      >
        {accounts.length === 0 ? (
          <p className="mt-5 text-[15px] text-suave">Conecte a Meta Ads para listar as contas.</p>
        ) : (
          <>
            <ActionForm action={saveAccountSelection} className="mt-5">
              <ul className="divide-y divide-borda border-b border-borda">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-4 px-4 py-3.5 hover:bg-cartao2/50">
                      <input type="checkbox" name="account" value={a.id} defaultChecked={a.active} className="h-5 w-5 accent-destaque" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{a.name}</span>
                        <span className="block font-mono text-xs text-suave">
                          {a.id}
                          {a.currency !== 'BRL' && <span className="ml-2 text-amarelo">moeda {a.currency}</span>}
                        </span>
                        {a.lastError && <span className="block text-xs text-vermelho">{a.lastError}</span>}
                      </span>
                      <span className="text-sm text-suave" title="Gasto nos últimos 30 dias">
                        {formatBRL(spendByAccount.get(a.id) ?? 0)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-5">
                <Submit busy="Salvando e sincronizando…">Salvar seleção</Submit>
                <button type="reset" className="text-[15px] text-texto/80 hover:text-texto">
                  Desfazer alterações
                </button>
              </div>
            </ActionForm>
            {accounts.length > activeCount && (
              <ActionForm
                action={removeInactiveAccounts}
                className="mt-3"
                confirm="Remover do banco as contas desmarcadas, com campanhas e gasto? Isso não pode ser desfeito."
              >
                <Submit variant="link" busy="Removendo…">
                  Remover as desmarcadas
                </Submit>
              </ActionForm>
            )}
          </>
        )}
      </Card>

      {/* ── CAPI ───────────────────────────────────────────────── */}
      <Card
        title="Conversions API da Meta"
        desc="Envia cada venda aprovada direto do servidor para o pixel. O pixel do navegador perde compras por bloqueador, iOS e aba fechada cedo — e o que a Meta não vê, ela não usa para otimizar."
      >
        <ActionForm action={saveCapi} className="mt-5 space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="rotulo">ID do pixel (dataset)</span>
              <input name="pixel" defaultValue={pixel ?? ''} className="campo mt-2 font-mono" inputMode="numeric" />
            </label>
            <label className="block">
              <span className="rotulo">
                Código de teste <span className="text-suave/70">(opcional)</span>
              </span>
              <input name="test" defaultValue={testCode ?? ''} className="campo mt-2 font-mono" />
              <span className={`mt-2 block text-xs ${testCode ? 'text-amarelo' : 'text-suave'}`}>
                Com código preenchido os eventos vão só para a aba <strong>Testar eventos</strong> e não afetam a otimização. Apague o
                campo para valer de verdade.
              </span>
            </label>
          </div>
          <label className="block">
            <span className="rotulo">Token de acesso</span>
            <input
              name="token"
              type="password"
              className="campo mt-2 font-mono text-sm"
              placeholder={capiToken ? 'Token configurado — cole outro para substituir' : 'EAAxxxx…'}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <Submit>Salvar</Submit>
            <span className="text-sm text-suave">
              {capiStats._count} venda(s) enviada(s)
              {capiStats._max.capiSentAt ? ` · última ${formatDateTime(capiStats._max.capiSentAt)}` : ''}
              {capiErrors ? <span className="text-vermelho"> · {capiErrors} com erro</span> : null}
            </span>
          </div>
        </ActionForm>
      </Card>

      {/* ── Checkout ───────────────────────────────────────────── */}
      <Card
        title="Plataformas de checkout"
        desc="Cole a URL abaixo no painel de webhooks da plataforma. Todo evento recebido é gravado cru antes de ser processado, então nenhuma venda se perde se o mapeamento precisar de ajuste."
      >
        {platforms.length === 0 && (
          <p className="mt-5 text-[15px] text-amarelo">
            Nenhuma plataforma habilitada. Defina CHECKOUT_PLATFORMS (ex.: <code>wiapy</code> ou <code>kiwify</code>) na Vercel e faça
            um novo deploy.
          </p>
        )}
        <div className="mt-5 space-y-5">
          {platforms.map((id) => {
            const p = ALL_PROVIDERS[id];
            const integ = integrations.find((i) => i.id === id);
            const count = saleCounts.find((c) => c.platform === id)?._count ?? 0;
            const last = events.find((e) => e.platform === id);
            const unit = p.amountUnit();
            return (
              <div key={id} className="rounded-xl border border-borda bg-cartao2/60 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">{p.label}</h3>
                  <span className={`text-sm ${last ? 'text-verde' : 'text-suave'}`}>
                    {count} venda(s) · {last ? `último webhook ${formatDateTime(last.receivedAt)}` : 'nenhum webhook recebido ainda'}
                  </span>
                </div>
                {!unit && (
                  <p className="mt-3 text-sm text-vermelho">
                    Falta definir a unidade dos valores ({id.toUpperCase()}_AMOUNT_UNIT = cents ou decimal). Até lá, os webhooks ficam
                    guardados com erro e nenhuma venda entra.
                  </p>
                )}
                {!p.verified && (
                  <p className="mt-3 text-sm text-amarelo">
                    Mapeamento ainda não conferido com um payload real desta conta. Confira a primeira venda em &quot;Últimos webhooks
                    recebidos&quot;.
                  </p>
                )}
                <p className="rotulo mt-5">URL do webhook</p>
                <div className="mt-2">
                  <CopyField value={`${origin}/api/webhooks/${id}`} />
                </div>
                <ActionForm action={reprocessWebhooks} className="mt-3">
                  <input type="hidden" name="platform" value={id} />
                  <Submit variant="secundario" busy="Reprocessando…">
                    Reprocessar webhooks
                  </Submit>
                </ActionForm>

                <p className="rotulo mt-6">Segredo do webhook</p>
                <ActionForm action={saveWebhookSecret} className="mt-2">
                  <input type="hidden" name="platform" value={id} />
                  <div className="flex flex-wrap gap-3">
                    <input
                      name="secret"
                      type="password"
                      autoComplete="off"
                      className="campo min-w-[240px] flex-1 bg-fundo"
                      placeholder={integ?.webhookSecret ? 'Segredo configurado — cole outro para substituir' : 'Cole o segredo/token do webhook'}
                    />
                    <Submit variant="secundario">Salvar</Submit>
                    {integ?.webhookSecret && (
                      <Submit variant="secundario" name="remove" value="1" busy="Removendo…">
                        Remover
                      </Submit>
                    )}
                  </div>
                  <p className={`mt-3 text-sm ${integ?.webhookSecret ? 'text-verde' : 'text-vermelho'}`}>
                    {integ?.webhookSecret
                      ? 'Protegido: webhook sem o segredo correto é recusado.'
                      : 'Aberto: sem segredo, esta URL aceita qualquer requisição — qualquer um pode criar vendas falsas.'}
                  </p>
                  <p className="mt-1 text-xs text-suave">{p.secretHelp}</p>
                  {integ?.lastError && <p className="mt-1 text-xs text-vermelho">{integ.lastError}</p>}
                </ActionForm>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Importação ─────────────────────────────────────────── */}
      <Card
        title="Importar histórico"
        desc="O webhook só entrega o que acontece daqui para frente. Importe a exportação de vendas (CSV ou XLSX) da plataforma: mesmo id do webhook, então pode importar de novo sem duplicar. Datas lidas no horário de Brasília. UTM e cookies entram só quando a exportação os traz (a da Hubla traz); sem eles, a venda fica sem campanha."
      >
        <div className="mt-5">
          <ImportForm platforms={platforms.map((id) => ({ id, label: ALL_PROVIDERS[id].label }))} />
        </div>
      </Card>

      {/* ── Custos ─────────────────────────────────────────────── */}
      <Card
        title="Custo por produto"
        desc={
          <>
            Quanto custa produzir e entregar <strong className="text-texto">uma</strong> unidade. Entra no Lucro multiplicado pela
            quantidade vendida — não afeta o Faturamento.
          </>
        }
      >
        {products.length === 0 ? (
          <p className="mt-5 text-[15px] text-suave">Os produtos aparecem aqui depois da primeira venda.</p>
        ) : (
          <ActionForm action={saveProductCosts} className="mt-5">
            <ul className="divide-y divide-borda border-b border-borda">
              {products.map((p) => {
                const key = productKey(p.platform, p.productId, p.productName);
                const cost = costMap.get(key) ?? 0;
                return (
                  <li key={key} className="flex items-center gap-4 px-4 py-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{p.productName}</span>
                      <span className="block text-xs text-suave">
                        {p._count} venda(s) · {ALL_PROVIDERS[p.platform]?.label ?? p.platform}
                      </span>
                    </span>
                    <input type="hidden" name={`name:${key}`} value={p.productName} />
                    <span className="text-sm text-suave">R$</span>
                    <input
                      name={`cost:${key}`}
                      defaultValue={(cost / 100).toFixed(2).replace('.', ',')}
                      className={`campo w-28 text-right ${cost === 0 ? 'border-amarelo/60' : ''}`}
                      inputMode="decimal"
                      aria-label={`Custo de ${p.productName}`}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="mt-5">
              <Submit>Salvar custos</Submit>
            </div>
          </ActionForm>
        )}
      </Card>

      {/* ── Webhooks recebidos ─────────────────────────────────── */}
      <Card title="Últimos webhooks recebidos" desc="Clique num evento para ver o payload cru e conferir de quais campos o mapeamento deve ler.">
        {events.length === 0 ? (
          <p className="mt-5 text-[15px] text-suave">Nenhum webhook recebido ainda.</p>
        ) : (
          <ul className="mt-5 space-y-2.5">
            {events.map((e) => {
              const color =
                e.status === 'processed' ? 'bg-verde' : e.status === 'ignored' ? 'bg-suave' : e.status === 'error' ? 'bg-vermelho' : 'bg-amarelo';
              return (
                <li key={e.id}>
                  <details className="rounded-lg border border-borda bg-cartao2/60">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5">
                      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
                      <span className="text-[15px]">{e.eventName ?? 'evento sem nome'}</span>
                      <span className="text-sm text-suave">{formatDateTime(e.receivedAt)}</span>
                      <span className="text-sm text-suave">
                        {
                          ({ processed: 'processado', ignored: 'ignorado', error: 'erro', received: 'recebido' } as Record<string, string>)[
                            e.status
                          ]
                        }
                        {e.externalId ? ` · pedido ${e.externalId}` : ''}
                      </span>
                      <span className="ml-auto text-sm text-suave">ver payload</span>
                    </summary>
                    {e.error && <p className="px-5 pb-2 text-sm text-vermelho">{e.error}</p>}
                    <pre className="max-h-96 overflow-auto border-t border-borda px-5 py-4 text-xs text-suave">{prettyJson(e.rawBody)}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Parâmetros ─────────────────────────────────────────── */}
      <Card title="Parâmetros de cálculo">
        <ActionForm action={saveCalcParams} className="mt-5">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="rotulo">Imposto sobre anúncios (%)</span>
              <input name="tax" defaultValue={(calc.taxBps / 100).toFixed(2).replace('.', ',')} className="campo mt-2" inputMode="decimal" />
              <span className="mt-2 block text-xs text-suave">
                Padrão 7,38% — efetivo de CIDE, PIS/COFINS e ISS sobre mídia comprada no exterior.
              </span>
            </label>
            <label className="block">
              <span className="rotulo">Custo fixo por venda (R$)</span>
              <input
                name="fixed"
                defaultValue={(calc.fixedCostPerSaleCents / 100).toFixed(2).replace('.', ',')}
                className="campo mt-2"
                inputMode="decimal"
              />
              <span className="mt-2 block text-xs text-suave">Ex.: taxa de antecipação ou custo de entrega por pedido aprovado.</span>
            </label>
          </div>
          <div className="mt-5">
            <Submit>Salvar</Submit>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
