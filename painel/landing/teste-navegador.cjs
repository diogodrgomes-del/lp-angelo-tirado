/* Teste do repassa-utm.js num Chromium de verdade.
   node landing/teste-navegador.cjs   (precisa do playwright instalado) */
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, 'repassa-utm.js'), 'utf8');
const pagina = (extra = '') => `<!doctype html><html><head>
<script src="/repassa-utm.js" data-checkout="pay.wiapy.com"></script></head><body>
<a id="comprar" href="https://pay.wiapy.com/oferta?x=1">Comprar</a>
<a id="whats" href="https://wa.me/5511999999999">WhatsApp</a>
<a id="interno" href="/obrigado">Interno</a>
<a id="sobrescrito" href="https://pay.wiapy.com/outra">Outra</a>
<script>
  // outro script reescreve o link DEPOIS do load (como fazem pixels e testes A/B)
  window.addEventListener('load', function () {
    setTimeout(function () { document.getElementById('sobrescrito').href = 'https://pay.wiapy.com/reescrito'; }, 50);
  });
</script>${extra}
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/repassa-utm.js')) { res.setHeader('content-type', 'text/javascript'); return res.end(script); }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(pagina());
});

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let destino = null;
  await page.route('https://pay.wiapy.com/**', (route) => { destino = route.request().url(); route.fulfill({ body: 'checkout' }); });

  await page.goto(`${base}/?utm_source=FB&utm_campaign=Black%7C120200000000001&utm_medium=paid&fbclid=IwAR_teste&gclid=G1`);
  const href = await page.getAttribute('#comprar', 'href');
  const u = new URL(href);
  ok(u.searchParams.get('utm_source') === 'FB', 'utm_source no link na carga');
  ok(u.searchParams.get('utm_campaign') === 'Black|120200000000001', 'utm_campaign com "|ID" preservado');
  ok(u.searchParams.get('fbclid') === 'IwAR_teste', 'fbclid no link');
  ok(u.searchParams.get('x') === '1', 'parâmetro original do link mantido');
  ok((await page.getAttribute('#whats', 'href')) === 'https://wa.me/5511999999999', 'link que não é checkout fica intacto');

  await page.waitForTimeout(200);
  await page.click('#sobrescrito');
  await page.waitForTimeout(300);
  ok(destino && new URL(destino).searchParams.get('fbclid') === 'IwAR_teste' && destino.includes('/reescrito'),
     `link reescrito por outro script recebe os parâmetros no clique (${destino})`);

  // segunda página da mesma visita, SEM utm na URL: vem do sessionStorage
  destino = null;
  await page.goto(`${base}/obrigado`);
  const h2 = new URL(await page.getAttribute('#comprar', 'href'));
  ok(h2.searchParams.get('fbclid') === 'IwAR_teste', 'navegação interna mantém os parâmetros (sessionStorage)');

  // nova visita (outra aba/sessão) não herda
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(`${base}/`);
  ok(!new URL(await p2.getAttribute('#comprar', 'href')).searchParams.get('fbclid'), 'nova sessão não herda a atribuição antiga');

  await browser.close();
  server.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
});
