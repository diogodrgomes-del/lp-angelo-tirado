# Painel de métricas (tráfego pago × vendas)

Cruza o gasto da Meta Ads com as vendas do checkout e mostra faturamento,
ROAS, ROI, lucro e taxa de aprovação. Next.js 15 + Prisma/PostgreSQL +
Tailwind, deploy na Vercel com banco Neon.

Telas: **Resumo** (cards + gráfico + avisos), **Vendas**, **Campanhas**,
**Integrações** (Meta, contas, Conversions API, webhooks, importação,
custos, parâmetros) e **Login**.

## Rodar localmente

```bash
npm install
cp .env.example .env.local            # preencha
npx prisma migrate deploy
node scripts/bootstrap.mjs
npm run dev
```

Testes:

```bash
npm test                                             # unitários
TEST_DATABASE_URL=postgresql://... npx vitest run    # + integração com banco descartável
node landing/teste-navegador.cjs                     # script da landing, em Chromium
```

## Métricas

| Métrica | Fórmula |
| --- | --- |
| Faturamento Líquido | soma do líquido das vendas **aprovadas**, pela data de **pagamento** |
| Gastos com anúncios | gasto diário por campanha da API, só das contas **marcadas** |
| ROAS | faturamento líquido ÷ gasto |
| Imposto sobre anúncios | gasto × alíquota (padrão 7,38%) |
| Lucro | líquido − mídia − imposto − custo do produto − custo fixo por venda |
| ROI | lucro ÷ (gasto + imposto) |
| Vendas Pendentes | pedidos pendentes, pela data do **pedido** |
| Taxa de Aprovação | aprovadas ÷ todas as tentativas (com pendentes), por método |
| Chargeback | contestações ÷ (aprovadas + contestações) |
| Vendas Reembolsadas | líquido das reembolsadas, pela data do reembolso |

Código: `src/lib/metrics.ts` (função pura, coberta por `tests/metrics.test.ts`).

### Decisões que explicam divergência com outros painéis

1. **Faturamento pela data de pagamento.** Pix gerado dia 1 e pago dia 5 é receita do dia 5. Pendentes contam pela data do pedido.
2. **Taxa de aprovação inclui pendentes no denominador.** Sem isso pix e boleto aparecem perto de 100%.
3. **Centavos inteiros no banco.** Texto → centavos por manipulação de string, nunca `parseFloat * 100`.
4. **O líquido preserva o sinal.** Venda de R$ 2,00 com taxa de R$ 2,11 = −R$ 0,11.
5. **Dia = dia de Brasília.** Data sem fuso é lida como −03:00.
6. **Evento atrasado não rebaixa status** e **data de pagamento conhecida não muda** (`src/lib/sales.ts`).

## Armadilhas cobertas (todas gravariam um número plausível e errado)

| Armadilha | Proteção | Onde |
| --- | --- | --- |
| Centavos × decimais | unidade declarada por plataforma; Wiapy exige `WIAPY_AMOUNT_UNIT`; decimal onde se espera centavos vira erro | `providers/*`, `money.ts` |
| ID do checkout vira venda pendente | só o id do pagamento/pedido; evento sem ele é ignorado | `providers/*` |
| `checkout.amount` sem orderbump | lê `payment.amount` | `providers/wiapy.ts` |
| `dt_update` de reembolso vira data de pagamento | só vale como pagamento com status pago | `providers/wiapy.ts` |
| Mapeamento errado perde venda | payload cru gravado antes; botão "Reprocessar webhooks" | `webhook.ts` |
| Saque / carrinho / sessão de checkout viram venda | filtro por evento e por ausência de pedido | `providers/*` |
| Rastreamento em `trackProps` × `tracking`, `user_agent` × `useragent` | busca tolerante a ninho e grafia | `tracking.ts` |
| Token enxerga contas de outros clientes | conta nova entra inativa se houver mais de uma; reconectar não desfaz a seleção | `meta.ts` (`activationFor`), `sync.ts` |
| Endpoint de plataforma sem uso | só existe para `CHECKOUT_PLATFORMS` | `providers/index.ts` |
| Webhook aberto | campo de segredo na tela; valor nunca volta do servidor | Integrações |
| `Number("27,90")` é NaN / data sem fuso | `parseBRL`, `parseLocalDateTime` | `importer.ts` |
| Atribuição inventada na importação | importação nunca preenche UTM | `importer.ts` |
| Token da Meta expira e o gasto congela | suporte a System User token; aviso no Resumo | Integrações, `health.ts` |

O Resumo mostra um quadro de **avisos** quando algum desses casos aparece:
token com erro ou expirando, webhook aberto, eventos com erro de mapeamento,
produto sem custo, CAPI em modo de teste e vendas chegando sem UTM.

## Checkout

- **Kiwify**: valores em centavos, `order_id`, assinatura `?signature=` (HMAC-SHA1 do corpo com o token).
- **Wiapy**: mapeamento estrito — se faltar um campo obrigatório, o evento vira erro e nada é gravado.
  Antes de ligar, confira um payload real (Integrações → Últimos webhooks → ver payload) e ajuste
  os caminhos em `src/lib/providers/wiapy.ts` se precisar; depois "Reprocessar webhooks".

Para outra plataforma: crie `src/lib/providers/<nome>.ts` seguindo `CheckoutProvider` e registre em `providers/index.ts`.

## Atribuição — landing page

`landing/repassa-utm.js` vai no `<head>` da landing page:

```html
<script src="/repassa-utm.js" data-checkout="pay.wiapy.com"></script>
```

Captura `utm_*`, `fbclid`, `gclid`, guarda em `sessionStorage` e aplica aos links do checkout na carga,
no fim da fila de eventos (`setTimeout 0` + `load`) e no clique em fase de captura.

Na Meta, em **Parâmetros de URL** do anúncio:

```
utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}&utm_content={{ad.name}}
```

O `|{{campaign.id}}` é o que liga a venda à campanha mesmo que o nome mude.

## Segurança

- Login e-mail + senha (scrypt). Contas em `AUTH_USERS` (variável de ambiente), nunca no banco.
- Cookie de sessão assinado (HMAC-SHA256), `<APP_SLUG>_session`, 14 dias. E-mail removido de `AUTH_USERS` perde acesso na hora.
- 8 tentativas erradas por IP a cada 15 min.
- Credenciais cifradas com AES-256-GCM. O bootstrap **aborta o deploy** se a `ENCRYPTION_KEY` mudar depois de cifrar algo.
- Webhook validado por assinatura/token. Nenhum segredo volta em resposta.

## Deploy (Vercel + Neon)

1. **Importar o repositório** na Vercel com **Root Directory = `painel`**.
2. **Apagar as variáveis vazias** que a Vercel cria a partir do `.env.example`.
3. **Banco:** Storage → Create Database → Neon.
   - Região: **a mesma das funções** (Hobby = `iad1`, Washington), não São Paulo.
   - **Custom Prefix vazio** (senão não existe `DATABASE_URL`).
   - **Neon Auth desligado.**
4. **Variáveis:** `ENCRYPTION_KEY`, `SESSION_SECRET`, `AUTH_USERS`, `CRON_SECRET`, `CHECKOUT_PLATFORMS`,
   `WIAPY_AMOUNT_UNIT` (se Wiapy), `NEXT_PUBLIC_PRODUCT_NAME`, `APP_SLUG`.
5. **Deploy.** O build roda `prisma migrate deploy` + `scripts/bootstrap.mjs` + `next build` (script `vercel-build`).
6. Plano Hobby: `maxDuration` ≤ 60 s; cron **uma vez por dia** (`0 6 * * *`, em `vercel.json`). Além dele, o Resumo
   relê o gasto em segundo plano quando o último sync tem mais de 15 min, e o botão **Atualizar** força.

## Manutenção

- **Token da Meta de usuário expira em ~60 dias** e o gasto só congela. Use um **System User token**
  (Business Manager → Usuários do sistema → gerar token com `ads_read`, validade "Nunca").
- **Nunca troque a `ENCRYPTION_KEY`** com integrações conectadas.
- Preencha **custo do produto** e **custo fixo por venda**, senão o lucro fica otimista.
