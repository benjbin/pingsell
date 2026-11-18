/**
 * The script a merchant pastes on any site (Wix, Squarespace, Framer, Webflow, WordPress, Shopify, Carrd…):
 *
 *   <div data-pingsell-form data-title="Restez au courant" data-tags="newsletter"></div>
 *   <script src="https://…/api/v1/public/forms/pk_…/embed.js" async></script>
 *
 * - renders a styled signup form in every `[data-pingsell-form]` (Shadow DOM: the site's CSS can't break it);
 * - sends any existing `<form data-pingsell>` to Pingsell (the site's own design, any field names);
 * - exposes `Pingsell.track('commande', { email, id, total })` for order-confirmation / booking pages;
 * - site tracking, with no code: every page (single-page apps too), every product page (read from the
 *   schema.org / Open Graph data shops already publish), and who the visitor is — a click in a Pingsell
 *   email, any form with an email on the site, or `Pingsell.identify(email)`. Waits for cookie consent when
 *   the merchant asks (`Pingsell.consent(true)`, Cookiebot, Axeptio).
 * Plain ES5, no dependency, ~7 KB.
 */
export const FORM_SCRIPT = `/* Pingsell — formulaire d'inscription */
(function () {
  var ENDPOINT = __PINGSELL_ENDPOINT__;
  if (window.__pingsellLoaded && window.__pingsellLoaded[ENDPOINT]) return;
  window.__pingsellLoaded = window.__pingsellLoaded || {};
  window.__pingsellLoaded[ENDPOINT] = true;
  var started = Date.now();

  function send(payload) {
    payload._page = payload._page || location.href;
    if (visitor()) payload._v = visitor();
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
        return j;
      });
    });
  }

  var api = window.Pingsell = window.Pingsell || {};
  /** Pingsell.track('reservation', { email: '…', id: 'R-12', date: '2026-12-24T19:30' }) */
  api.track = function (event, data) {
    var p = {}; data = data || {};
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) p[k] = data[k];
    p.event = event;
    return send(p);
  };
  /** Pingsell.subscribe('marie@exemple.fr', { first_name: 'Marie', tags: ['vip'] }) */
  api.subscribe = function (email, data) {
    var p = { email: email }; data = data || {};
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) p[k === 'tags' ? '_tags' : k] = data[k];
    return send(p);
  };


  /* ───────────── Site tracking ───────────── */
  var TRACK = __PINGSELL_TRACK__;
  // The Pingsell app's own preview of the form must not count as a visit of the merchant's site.
  if (window.__pingsellNoTrack) TRACK.on = false;
  var HIT = ENDPOINT + '/t';
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  };
  var granted = !TRACK.consent || store.get('ps_consent') === '1';
  var held = [];
  function visitor(create) {
    if (!TRACK.on || !granted) return null;
    var id = store.get('ps_vid');
    if (!id && create) {
      var a = new Uint8Array(16), c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < 16; i++) a[i] = Math.random() * 256;
      id = ''; for (var j = 0; j < 16; j++) id += c.charAt(a[j] & 63);
      store.set('ps_vid', id);
    }
    return id;
  }
  function hit(p) {
    if (!TRACK.on || navigator.webdriver) return;
    if (!granted) { if (held.length < 20) held.push(p); return; }
    p.v = visitor(true);
    var body = JSON.stringify(p);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(HIT, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    if (window.fetch) fetch(HIT, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
  }
  /** Pingsell.consent(true) once the visitor accepts cookies (or false to stop and forget them). */
  api.consent = function (yes) {
    if (yes) {
      store.set('ps_consent', '1');
      if (granted) return;
      granted = true;
      var q = held; held = [];
      for (var i = 0; i < q.length; i++) hit(q[i]);
    } else {
      granted = !TRACK.consent ? true : false;
      held = [];
      store.set('ps_consent', null);
      store.set('ps_vid', null);
      if (!TRACK.consent) TRACK.on = false;
    }
  };
  if (TRACK.on && TRACK.consent && !granted) {
    // Cookiebot: marketing or statistics accepted.
    var cb = function () { try { var c = window.Cookiebot && Cookiebot.consent; if (c && (c.marketing || c.statistics)) api.consent(true); } catch (e) {} };
    window.addEventListener('CookiebotOnAccept', cb); cb();
    // Axeptio: a vendor named « pingsell » in the cookie banner.
    (window._axcb = window._axcb || []).push(function (sdk) {
      sdk.on('cookies:complete', function (choices) { if (choices && choices.pingsell) api.consent(true); });
    });
  }

  /** Product shown on this page: schema.org Product (JSON-LD), else Open Graph product tags. */
  var manualProduct = null;
  api.product = function (p) { manualProduct = p || null; };
  function first(v) { return v && v.length !== undefined && typeof v !== 'string' ? v[0] : v; }
  function findProduct(node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    if (node.length !== undefined) {
      for (var i = 0; i < node.length; i++) { var r = findProduct(node[i], depth + 1); if (r) return r; }
      return null;
    }
    var type = node['@type'];
    if (type === 'Product' || type === 'ProductGroup' || (type && type.indexOf && typeof type !== 'string' && (type.indexOf('Product') >= 0))) return node;
    return findProduct(node['@graph'], depth + 1) || findProduct(node.mainEntity, depth + 1);
  }
  function meta(name) {
    var m = document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]');
    return m ? m.getAttribute('content') : null;
  }
  function product() {
    if (manualProduct) return manualProduct;
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      var p = null;
      try { p = findProduct(JSON.parse(nodes[i].textContent || 'null'), 0); } catch (e) {}
      if (!p || !p.name) continue;
      var offer = first(p.offers) || {};
      if (offer.offers) offer = first(offer.offers) || offer;
      var img = first(p.image);
      if (img && typeof img === 'object') img = img.url || img.contentUrl;
      return {
        name: String(p.name),
        url: p.url || location.href,
        image: typeof img === 'string' ? img : undefined,
        price: offer.price !== undefined ? offer.price : offer.lowPrice,
        currency: offer.priceCurrency,
        sku: p.sku || p.productID || p.mpn
      };
    }
    var og = (meta('og:type') || '').toLowerCase();
    if (og === 'product' || og === 'og:product' || meta('product:price:amount')) {
      return {
        name: meta('og:title') || document.title,
        url: meta('og:url') || location.href,
        image: meta('og:image') || undefined,
        price: meta('product:price:amount') || meta('og:price:amount') || undefined,
        currency: meta('product:price:currency') || meta('og:price:currency') || undefined,
        sku: meta('product:retailer_item_id') || undefined
      };
    }
    return null;
  }

  var lastUrl = null, token = null;
  try {
    var qs = new URLSearchParams(location.search);
    token = qs.get('ps_t');
    if (token && history.replaceState) {
      qs.delete('ps_t');
      var rest = qs.toString();
      history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
  } catch (e) {}
  function page() {
    var url = location.href.split('#')[0];
    if (url === lastUrl) return;
    lastUrl = url;
    var p = { k: 'page', u: url, ti: document.title.slice(0, 300), r: document.referrer.slice(0, 500) };
    var pr = product(); if (pr) p.p = pr;
    if (token) { p.tk = token; token = null; }
    hit(p);
  }
  /** Pingsell.identify('marie@exemple.fr'): ties this visitor (and the pages seen so far) to the contact. */
  api.identify = function (email) { if (email && String(email).indexOf('@') > 0) hit({ k: 'id', e: String(email).trim() }); };
  /** Pingsell.page(): count a page by hand (rarely needed, single-page apps are handled). */
  api.page = function () { lastUrl = null; page(); };
  if (TRACK.on) {
    // Any form on the site with an email in it (newsletter, account, checkout, contact…).
    document.addEventListener('submit', function (e) {
      var f = e.target; if (!f || !f.querySelectorAll) return;
      var inputs = f.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i], n = (el.name || el.id || '').toLowerCase();
        if ((el.type === 'email' || n.indexOf('email') >= 0 || n.indexOf('mail') >= 0) && el.value.indexOf('@') > 0) { api.identify(el.value); return; }
      }
    }, true);
    // Single-page sites (Framer, Wix, Webflow, React…): count each navigation.
    var navigated = function () { setTimeout(page, 400); };
    var wrap = function (name) {
      var orig = history[name];
      if (!orig) return;
      history[name] = function () { var r = orig.apply(this, arguments); navigated(); return r; };
    };
    wrap('pushState'); wrap('replaceState');
    window.addEventListener('popstate', navigated);
    if (document.readyState === 'complete') setTimeout(page, 50); else window.addEventListener('load', function () { setTimeout(page, 50); });
  }

  function attr(el, name, fallback) {
    var v = el.getAttribute('data-' + name);
    return v === null || v === '' ? fallback : v;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  var LABELS = { email: 'Votre email', first_name: 'Prénom', last_name: 'Nom', phone: 'Téléphone' };
  var TYPES = { email: 'email', phone: 'tel' };

  function render(host) {
    if (host.__pingsell) return;
    host.__pingsell = true;
    var color = attr(host, 'color', '#145CFF');
    if (!/^#[0-9a-f]{3,8}$/i.test(color)) color = '#145CFF';
    var seen = {};
    var fields = attr(host, 'fields', 'email').split(',').map(function (f) { return f.trim(); }).filter(function (f) {
      if (!Object.prototype.hasOwnProperty.call(LABELS, f) || seen[f]) return false;
      return (seen[f] = true);
    });
    if (fields.indexOf('email') < 0) fields.push('email');
    var title = attr(host, 'title', 'Restez au courant');
    var text = attr(host, 'text', 'Nouveautés, offres et coulisses : directement dans votre boîte mail.');
    var button = attr(host, 'button', 'Je m’inscris');
    var success = attr(host, 'success', 'Merci, c’est noté ! À très vite.');
    var consent = attr(host, 'consent', 'En vous inscrivant, vous acceptez de recevoir nos emails. Désinscription en un clic.');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var shown = Date.now();
    var inputs = fields.map(function (f) {
      return '<label><span>' + esc(LABELS[f]) + '</span><input name="' + f + '" type="' + (TYPES[f] || 'text') + '"' +
        (f === 'email' ? ' required autocomplete="email" inputmode="email"' : ' autocomplete="' + (f === 'first_name' ? 'given-name' : f === 'last_name' ? 'family-name' : 'tel') + '"') +
        ' placeholder="' + esc(LABELS[f]) + '"></label>';
    }).join('');
    root.innerHTML =
      '<style>' +
      ':host{display:block}' +
      '.ps{box-sizing:border-box;font:inherit;color:inherit;max-width:520px;padding:24px;border-radius:20px;background:rgba(127,127,127,.07)}' +
      '.ps *{box-sizing:border-box}' +
      '.ps h3{margin:0 0 6px;font-size:1.25em;line-height:1.2}' +
      '.ps p{margin:0 0 16px;opacity:.75;font-size:.95em;line-height:1.5}' +
      '.ps form{display:flex;flex-wrap:wrap;gap:8px}' +
      '.ps label{flex:1 1 180px;margin:0}' +
      '.ps label span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
      '.ps input{width:100%;height:46px;padding:0 14px;border:1px solid rgba(127,127,127,.35);border-radius:12px;background:#fff;color:#111;font:inherit;font-size:16px}' +
      '.ps input:focus{outline:2px solid ' + color + ';outline-offset:1px;border-color:transparent}' +
      '.ps button{flex:0 0 auto;height:46px;padding:0 20px;border:0;border-radius:12px;background:' + color + ';color:#fff;font:inherit;font-weight:700;cursor:pointer}' +
      '.ps button[disabled]{opacity:.6;cursor:wait}' +
      '.ps .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}' +
      '.ps small{display:block;margin-top:10px;opacity:.6;font-size:.78em;line-height:1.4}' +
      '.ps .msg{margin-top:10px;font-size:.9em}.ps .err{color:#c0262d}' +
      '.ps .done{font-weight:700;margin:0;opacity:1}' +
      '@media (max-width:480px){.ps button{width:100%}}' +
      '</style>' +
      '<div class="ps" part="container">' +
      (title ? '<h3 part="title">' + esc(title) + '</h3>' : '') +
      (text ? '<p part="text">' + esc(text) + '</p>' : '') +
      '<form novalidate>' + inputs +
      '<input class="hp" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button type="submit" part="button">' + esc(button) + '</button></form>' +
      (consent ? '<small>' + esc(consent) + '</small>' : '') +
      '<div class="msg" role="status" aria-live="polite"></div></div>';
    var form = root.querySelector('form');
    var msg = root.querySelector('.msg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('[name=email]');
      if (!email.value || email.value.indexOf('@') < 1) { msg.className = 'msg err'; msg.textContent = 'Indiquez une adresse email valide.'; email.focus(); return; }
      var payload = { _t: Date.now() - Math.max(started, shown), _tags: attr(host, 'tags', ''), _event: attr(host, 'event', '') };
      Array.prototype.forEach.call(form.querySelectorAll('input'), function (i) { if (i.name) payload[i.name] = i.value; });
      var btn = form.querySelector('button');
      btn.disabled = true; msg.className = 'msg'; msg.textContent = '';
      send(payload).then(function () {
        form.style.display = 'none';
        msg.className = 'msg'; msg.innerHTML = '<p class="done">' + esc(success) + '</p>';
        host.dispatchEvent(new CustomEvent('pingsell:success', { bubbles: true, detail: { email: payload.email } }));
        var go = attr(host, 'redirect', ''); if (/^https?:\\/\\//.test(go)) location.href = go;
      }).catch(function (err) {
        btn.disabled = false; msg.className = 'msg err'; msg.textContent = err.message || 'Une erreur est survenue, réessayez.';
      });
    });
  }

  /** <form data-pingsell data-tags="salon"> … any fields, any design … </form> */
  function bind(form) {
    if (form.__pingsell) return;
    form.__pingsell = true;
    var shown = Date.now();
    var note = null;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = { _t: Date.now() - Math.max(started, shown), _tags: attr(form, 'tags', ''), _event: attr(form, 'event', '') };
      var data = new FormData(form);
      data.forEach(function (v, k) { if (typeof v === 'string' && payload[k] === undefined) payload[k] = v; });
      var btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
      send(payload).then(function () {
        form.dispatchEvent(new CustomEvent('pingsell:success', { bubbles: true, detail: { email: payload.email } }));
        var go = attr(form, 'redirect', '');
        if (/^https?:\\/\\//.test(go)) { location.href = go; return; }
        var done = document.createElement('p');
        done.setAttribute('role', 'status');
        done.textContent = attr(form, 'success', 'Merci, c’est noté !');
        form.parentNode.replaceChild(done, form);
      }).catch(function (err) {
        if (btn) btn.disabled = false;
        form.dispatchEvent(new CustomEvent('pingsell:error', { bubbles: true, detail: { message: err.message } }));
        if (!note) {
          note = document.createElement('p');
          note.setAttribute('role', 'alert');
          note.style.color = '#c0262d';
          form.appendChild(note);
        }
        note.textContent = err.message || 'Une erreur est survenue, réessayez.';
      });
    });
  }

  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-pingsell-form]'), render);
    Array.prototype.forEach.call(document.querySelectorAll('form[data-pingsell]'), bind);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  // Site builders (Wix, Framer, Webflow interactions) add blocks after load.
  var pending = false;
  function later() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () { pending = false; scan(); });
  }
  if (window.MutationObserver) new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
  // Queue calls made before (and after) the script loaded: window.Pingsell = window.Pingsell || { q: [] }; Pingsell.q.push(['track', …])
  var queued = api.q && api.q.forEach ? api.q : [];
  api.q = {
    push: function (c) {
      if (!c || !api[c[0]] || c[0] === 'q') return;
      var r = api[c[0]].apply(null, Array.prototype.slice.call(c, 1));
      if (r && r.catch) r.catch(function (e) { if (window.console) console.warn('Pingsell :', e.message); });
    }
  };
  queued.forEach(api.q.push);
})();
`;
