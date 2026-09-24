/* ══════════════════════════════════════════════════════════════════
   MEDICAO DE CLIQUES — usada pelas duas paginas (index e resultados)

   Tudo que precisa ser preenchido esta neste bloco. Campo vazio =
   aquela ferramenta fica desligada e nenhum script dela e carregado.

   Cada clique vira UM evento com o mesmo nome no GA4, no Google Ads
   (se tiver rotulo de conversao) e na Meta. A lista completa esta em
   EVENTOS, mais abaixo.
   ══════════════════════════════════════════════════════════════════ */
var MEDICAO = {

  /* ▸ GOOGLE ANALYTICS 4 — ID de medicao, formato G-XXXXXXXXXX
       (GA4 > Administrador > Fluxos de dados > Web)                  */
  GA4: '',

  /* ▸ GOOGLE ADS — ID da conta, formato AW-XXXXXXXXXX
       (Google Ads > Metas > Conversoes > a conversao > Configurar tag
        > "Instalar a tag voce mesmo": e o valor depois de send_to,
        antes da barra)                                              */
  GOOGLE_ADS: 'AW-18466662076',

  /* ▸ ROTULOS DE CONVERSAO DO GOOGLE ADS — a parte DEPOIS da barra em
       send_to: 'AW-XXXXXXXXXX/ESTE_PEDACO'. Crie uma conversao no Ads
       para cada acao que quiser contar como conversao e cole o rotulo.
       Vazio = aquele clique nao vira conversao no Ads (continua sendo
       medido no GA4 normalmente).                                   */
  CONVERSOES_ADS: {
    clique_whatsapp:     '',   /* a principal: agendamento          */
    clique_como_chegar:  '',
    clique_catalogo:     '',
    clique_instagram:    ''
  },

  /* ▸ PIXEL DA META — so numeros (15 ou 16 digitos). Opcional.       */
  PIXEL_META: '',

  /* ▸ Conversions API da Meta — endereco do servidor. Opcional.
       O TOKEN nunca entra aqui: ele fica no servidor.                */
  CAPI_ENDPOINT: ''
};

(function () {
  'use strict';

  var M = MEDICAO;
  var temGA4  = /^G-[A-Z0-9]{4,}$/i.test(M.GA4);
  var temAds  = /^AW-\d{6,}$/i.test(M.GOOGLE_ADS);
  var temMeta = /^\d{8,20}$/.test(M.PIXEL_META);

  /* ── nome de cada evento na Meta ────────────────────────────────
     "Contact" e o evento PADRAO da Meta para inicio de conversa; os
     outros vao como eventos personalizados com o mesmo nome do GA4. */
  var META_PADRAO = { clique_whatsapp: 'Contact' };

  /* ── tag do Google (gtag.js): um script so para GA4 e Ads ───────── */
  if (temGA4 || temAds) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    if (temGA4) gtag('config', M.GA4);
    if (temAds) gtag('config', M.GOOGLE_ADS);

    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' +
            encodeURIComponent(temGA4 ? M.GA4 : M.GOOGLE_ADS);
    document.head.appendChild(g);
  }

  /* ── pixel da Meta ──────────────────────────────────────────────── */
  if (temMeta) {
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
      d.head.appendChild(s);
    })(window, document);
    fbq('init', M.PIXEL_META);
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
  function pagina() {
    return /resultados/.test(location.pathname) ? 'antes_depois' : 'inicio';
  }

  /* ══════════════════════════════════════════════════════════════════
     registrar(evento, dados) — manda UM evento para todas as
     ferramentas ligadas. dados sao parametros extras (ex.: procedimento).
     Nunca lanca erro: medicao nao pode atrapalhar o clique.
     ══════════════════════════════════════════════════════════════════ */
  window.registrar = function (evento, dados) {
    try {
      var params = { pagina: pagina() };
      for (var k in dados) if (dados.hasOwnProperty(k)) params[k] = dados[k];
      var idEvento = novoId();

      if (typeof gtag === 'function') {
        /* GA4 manda por sendBeacon: o evento sai mesmo se a pagina
           trocar logo em seguida */
        if (temGA4) gtag('event', evento, Object.assign({ send_to: M.GA4 }, params));
        var rotulo = M.CONVERSOES_ADS[evento];
        if (temAds && rotulo) {
          gtag('event', 'conversion', { send_to: M.GOOGLE_ADS + '/' + rotulo });
        }
      }

      if (typeof fbq === 'function') {
        if (META_PADRAO[evento]) fbq('track', META_PADRAO[evento], params, { eventID: idEvento });
        else fbq('trackCustom', evento, params, { eventID: idEvento });
      }

      if (M.CAPI_ENDPOINT) {
        var corpo = JSON.stringify({
          evento: META_PADRAO[evento] || evento, id: idEvento, url: location.href,
          dados: params, fbp: biscoito('_fbp'), fbc: biscoito('_fbc')
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(M.CAPI_ENDPOINT, new Blob([corpo], { type: 'application/json' }));
        } else {
          fetch(M.CAPI_ENDPOINT, { method: 'POST', body: corpo, keepalive: true,
                                   headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch (_) { /* medicao nunca pode atrapalhar o clique */ }
  };

  /* medir(id, evento, dados) — liga o registro ao clique de um elemento */
  window.medir = function (id, evento, dados) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () { registrar(evento, dados || {}); });
  };
})();
