/* Medicao de cliques — usada pelas duas paginas (index e resultados).
   Expoe window.medir(id, evento, padrao). */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     ▸ PIXEL DA META — cole aqui o ID (so numeros, 15 ou 16 digitos).
       Deixe vazio e nada de rastreio acontece: nenhum script externo
       e carregado e a pagina segue 100% offline.
     ══════════════════════════════════════════════════════════════════ */
  var PIXEL_META = '';

  /* Endereco do servidor da Conversions API. Vazio = so o pixel do
     navegador. O TOKEN nunca entra aqui: ele fica no servidor. */
  var CAPI_ENDPOINT = '';

  /* carrega o pixel so quando o ID parece de verdade — assim um campo
     preenchido errado nao vira requisicao quebrada em toda visita */
  if (/^\d{8,20}$/.test(PIXEL_META)) {
    (function (j, d) {
      if (j.fbq) return;
      var n = j.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!j._fbq) j._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      var s = d.createElement('script');
      s.async = true;
      s.src = 'https://connect.facebook.net/en_US/fbevents.js';
      var p = d.getElementsByTagName('script')[0];
      p.parentNode.insertBefore(s, p);
    })(window, document);
    fbq('init', PIXEL_META);
    fbq('track', 'PageView');
  }

  /* id unico por clique: e o que permite a Meta juntar o evento do
     navegador com o mesmo evento vindo do servidor, sem contar duas vezes */
  function novoId() {
    return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function biscoito(nome) {
    var m = document.cookie.match('(^|; )' + nome + '=([^;]*)');
    return m ? decodeURIComponent(m[2]) : '';
  }

  window.medir = function (id, evento, padrao) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      var idEvento = novoId();
      if (typeof fbq === 'function') {
        fbq(padrao ? 'track' : 'trackCustom', evento, {}, { eventID: idEvento });
      }
      if (!CAPI_ENDPOINT) return;
      var corpo = JSON.stringify({
        evento: evento, id: idEvento, url: location.href,
        fbp: biscoito('_fbp'), fbc: biscoito('_fbc')
      });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(CAPI_ENDPOINT, new Blob([corpo], { type: 'application/json' }));
        } else {
          fetch(CAPI_ENDPOINT, { method: 'POST', body: corpo, keepalive: true,
                                 headers: { 'Content-Type': 'application/json' } });
        }
      } catch (_) { /* medicao nunca pode atrapalhar o clique */ }
    });
  };
})();
