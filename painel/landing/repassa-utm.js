/* ══════════════════════════════════════════════════════════════════
   REPASSA UTM — landing page → checkout

   O checkout fica em OUTRO domínio e nada atravessa sozinho: nem a query
   string, nem os cookies do pixel. Sem este script toda venda chega como
   "direto" e o painel nunca liga venda a campanha.

   Como usar (no <head> da landing page, antes dos outros scripts):
     <script src="/repassa-utm.js" data-checkout="pay.wiapy.com"></script>
   data-checkout: domínios do checkout separados por vírgula. Sem ele, o
   script reconhece os checkouts mais comuns (Wiapy, Kiwify, Hotmart…).

   - Captura utm_*, fbclid, gclid (e src/sck) da URL.
   - Guarda em sessionStorage (vale para ESTA visita; localStorage
     atribuiria a venda de semana que vem ao clique de hoje).
   - Aplica aos links do checkout em três momentos: na carga, no fim da
     fila de eventos (setTimeout 0 + load — outros scripts reescrevem
     hrefs depois) e no clique, em fase de captura.
   - fbclid é obrigatório: é dele que o pixel do checkout deriva o _fbc,
     que é como a Meta casa a compra com o clique.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
              'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'src', 'sck'];
  var STORE = 'repassa_utm';
  var PADRAO = /(^|\.)(wiapy\.com|kiwify\.com\.br|kiwify\.app|hotmart\.com|pay\.hotmart\.com|braip\.com|eduzz\.com|sun\.eduzz\.com|ticto\.app|hub\.la|hubla\.com|perfectpay\.com\.br|cakto\.com\.br|yampi\.com\.br|greenn\.com\.br|monetizze\.com\.br|payt\.com\.br|lastlink\.com|doppus\.com)$/i;

  var me = document.currentScript;
  var lista = ((me && me.getAttribute('data-checkout')) || '')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

  function ehCheckout(host) {
    host = (host || '').toLowerCase();
    if (lista.length) {
      for (var i = 0; i < lista.length; i++) {
        if (host === lista[i] || host.slice(-(lista[i].length + 1)) === '.' + lista[i]) return true;
      }
      return false;
    }
    return PADRAO.test(host);
  }

  function ler() {
    try { return JSON.parse(sessionStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; }
  }

  /* 1. captura: parâmetros desta URL substituem os guardados */
  var params = ler();
  try {
    var q = new URLSearchParams(location.search);
    var achou = false, novos = {};
    KEYS.forEach(function (k) { var v = q.get(k); if (v) { novos[k] = v; achou = true; } });
    if (achou) {
      params = novos;
      try { sessionStorage.setItem(STORE, JSON.stringify(params)); } catch (_) {}
    }
  } catch (_) {}

  function temAlgo() { for (var k in params) if (params.hasOwnProperty(k)) return true; return false; }

  function aplicarEm(a) {
    if (!a || !a.href || !temAlgo()) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (!ehCheckout(u.hostname)) return;
    var mudou = false;
    for (var k in params) {
      if (params.hasOwnProperty(k) && u.searchParams.get(k) !== params[k]) {
        u.searchParams.set(k, params[k]);
        mudou = true;
      }
    }
    if (mudou) a.href = u.toString();
  }

  function aplicarTodos() {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) aplicarEm(links[i]);
  }

  /* 2. três momentos */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicarTodos);
  else aplicarTodos();
  setTimeout(aplicarTodos, 0);
  window.addEventListener('load', function () { aplicarTodos(); setTimeout(aplicarTodos, 0); });

  /* clique em fase de CAPTURA: roda antes de qualquer outro handler */
  function noClique(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (el) aplicarEm(el);
  }
  document.addEventListener('click', noClique, true);
  document.addEventListener('auxclick', noClique, true);

  /* para botões que abrem o checkout por JS: window.repassaUtm('https://pay...') */
  window.repassaUtm = function (url) {
    var a = document.createElement('a');
    a.href = url;
    aplicarEm(a);
    return a.href;
  };
})();
