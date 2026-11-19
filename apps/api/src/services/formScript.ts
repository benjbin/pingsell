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
 * - action capture, with no code (merchant setting `act`, and only with cookie consent when it is required):
 *   any form of the site with an email in it is recognised as a création de compte (signup), connexion (login),
 *   newsletter, contact or other form — password-reset and checkout / payment forms are left out — and reported
 *   (`k:'act'`: email, first/last name, phone — never a password, hidden, card or IBAN field; token-looking URL
 *   segments masked) only once the submission succeeded: next page in the tab, single-page navigation, or the form
 *   removed, hidden or emptied within 20 s; nothing is sent when the form shows errors. Optional escape hatch on the
 *   form: `data-pingsell-action="signup|login|newsletter|contact|form|ignore"` and `data-pingsell-name="Inscription"`.
 * Plain ES5, no dependency, ~28 KB (~10 KB gzipped).
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
    beam(p);
  }
  function beam(p) {
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

  /* Actions: which form was sent (signup, login, newsletter, contact, form), reported once it succeeded. */
  // TRACK.act: the merchant's « Repérer les actions automatiquement » (missing in old cached configs = on).
  var ACT = TRACK.act !== false, KINDS = { signup: 1, login: 1, newsletter: 1, contact: 1, form: 1 };
  var PK = 'ps_pending:' + ENDPOINT.split('/').pop(), LIFE = 18e5;
  var EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  var SECRET = /\\bcc\\b|card|carte|cvc|cvv|csc|iban|\\bbic\\b|secu|\\bssn\\b/, PASSW = /pass|pwd|mot de passe|\\bmdp\\b/;
  var SIGNUP = /inscri|sign ?up|\\bregist|creer (un |mon |votre )?compte|create (an |your )?account|\\bjoin|rejoindre|nouveau compte|new account/;
  var LOGIN = /connexion|connecter|\\blog ?in\\b|sign ?in\\b|identifi/;
  var RESET = /oubli|forgot|reset|reinitialis|recuper|recover|lost password|nouveau mot de passe|change password|modifier le mot de passe/;
  var UNSUB = /unsubscri|desabonn|desinscri|opt ?out|me retirer/, REFER = /friend|\\bamis?\\b|recipient|destinataire|parrain|filleul|\\brefer|gift|cadeau|invit/;
  var PROFILE = /profile|profil|mon compte|my account|edit account|modifier (mon|le) compte|parametres|settings|password change|changement de mot de passe|changer (de |le |mon )?mot de passe/;
  var MINE = /creer (un |mon |votre )?compte|create (an |my |your )?account/g; // « Créer mon compte » is a signup, not a profile
  var SHOP = /checkout|commande|paiement|payment|panier|\\bcart\\b|billing|facturation|livraison|shipping/;
  var ERR = '[class*=error],[class*=Error],[class*=erreur],[class*=invalid],[class*=Invalid],[id*=error],[id*=erreur],[id*=invalid]';
  function norm(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
    return s.replace(/[-_.]+/g, ' ');
  }
  function txt(el) { return (el.textContent || '').replace(/\\s+/g, ' ').replace(/^ | $/g, ''); }
  function here() { return location.pathname + location.search; }
  /** Path segments / query values that look like a token (uuid, long hex, long letters+digits) → ':id'. */
  function mask(s) {
    return s.replace(/[^\\/?&=#]+/g, function (g) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g) || /^[0-9a-f]{16,}$/i.test(g) ||
        (/^[A-Za-z0-9]{16,}$/.test(g) && /[a-z]/i.test(g) && /[0-9]/.test(g)) ||
        /^[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}$/.test(g) ? ':id' : g;
    });
  }
  function pend() { try { return JSON.parse(sessionStorage.getItem(PK) || '{}') || {}; } catch (e) { return {}; } }
  function keep(m) {
    try { for (var k in m) { sessionStorage.setItem(PK, JSON.stringify(m)); return; } sessionStorage.removeItem(PK); } catch (e) {}
  }
  function drop(f, id) { var m = pend(); if (m[f] && (!id || m[f].id === id)) { delete m[f]; keep(m); } }
  /** Sends a pending action once (removed from the tab's storage first), with the visitor only if consented. */
  function land(f, id) {
    var m = pend(), P = m[f];
    if (!P || (id && P.id !== id)) return;
    delete m[f]; keep(m);
    if (Date.now() - P.t > LIFE || !TRACK.on || !ACT || !granted || window.__pingsellNoTrack || navigator.webdriver) return;
    var p = { k: 'act', a: P.a, f: P.f, l: P.l, u: P.u, e: P.e, v: visitor(true) };
    if (P.fn) p.fn = P.fn; if (P.ln) p.ln = P.ln; if (P.ph) p.ph = P.ph;
    beam(p);
  }
  function shown(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) {
      var cs = window.getComputedStyle ? getComputedStyle(el) : null;
      if (el.hidden || (cs && (cs.display === 'none' || cs.visibility === 'hidden'))) return false;
    }
    return el === document;
  }
  function heading(form) {
    var h = form.querySelector('h1,h2,h3,h4,legend');
    for (var n = form, up = 0; !h && n && n !== document.body && up < 3; n = n.parentNode, up++) {
      for (var s = n.previousElementSibling; s && !h; s = s.previousElementSibling) {
        if (/^(H[1-4]|LEGEND)$/.test(s.tagName)) h = s;
        else { var l = s.querySelectorAll('h1,h2,h3,h4'); h = l[l.length - 1]; }
      }
    }
    return h ? txt(h) : '';
  }
  /** Same form on every page (footer newsletter) = same key: '#' + name, id, name or action; else path + '#form<n>'. */
  function formKey(form) {
    var k = form.getAttribute('data-pingsell-name') || form.getAttribute('id') || form.getAttribute('name'), act = form.getAttribute('action');
    if (!k && act && !/^(#|javascript:)/i.test(act)) {
      var a = document.createElement('a'); a.href = act;
      k = (a.hostname && a.hostname !== location.hostname ? a.hostname : '') + mask(a.pathname || '');
    }
    return (k ? '#' + k : mask(location.pathname) + '#form' + Array.prototype.indexOf.call(document.forms, form)).slice(0, 200);
  }
  /** Reads only email, names and phone; counts the visible fields (never reads passwords, hidden or card fields). */
  function scrape(form) {
    var r = { pw: 0, n: 0, ta: 0, nm: 0, tel: 0, ox: 0 }, els = form.elements || [], full = '';
    for (var i = 0; i < els.length; i++) {
      var el = els[i], ty = String(el.type || '').toLowerCase();
      if (!/^(text|email|tel|search|url|number|password|textarea|select-one|select-multiple)$/.test(ty) || !shown(el)) continue;
      if (el.getAttribute('tabindex') === '-1' || (el.closest && el.closest('[aria-hidden=true]'))) continue; // honeypots
      var ac = norm(el.getAttribute('autocomplete')), nm = norm(el.getAttribute('name')), key = nm + ' ' + norm(el.id) + ' ' + ac;
      if (ty === 'password' || PASSW.test(key)) { r.pw++; if (ac === 'current password') r.cur = 1; continue; }
      r.n++;
      if (/address line|postal code|^cc |\\bcc /.test(ac)) r.shop = 1;
      if (ty === 'textarea') { r.ta++; continue; }
      if (ty.indexOf('select') === 0 || SECRET.test(key)) { r.ox++; continue; }
      if (ty === 'search' || /^(q|s|search|query|recherche|keywords?)$/.test(nm)) r.q = 1;
      var v = String(el.value || '').replace(/^\\s+|\\s+$/g, '');
      if (ty === 'email' || /mail/.test(key)) {
        // A friend's / recipient's address (referral, gift, invitation) is never the visitor's.
        var lb = ''; try { for (var b = 0; el.labels && b < el.labels.length; b++) lb += ' ' + txt(el.labels[b]); } catch (e) {}
        if (REFER.test(key + ' ' + norm(el.getAttribute('placeholder')) + ' ' + norm(el.getAttribute('aria-label')) + ' ' + norm(lb))) continue;
        if (!r.e && EMAIL.test(v)) { r.e = v.slice(0, 254); r.el = el; }
      }
      else if (ty === 'tel' || /^tel/.test(ac) || /phone|telephone|mobile|portable|\\btel\\b/.test(key)) { r.tel = 1; r.ox++; if (v && !r.ph) r.ph = v.slice(0, 40); }
      else if (ac === 'given name' || /prenom|first|given|\\bfname\\b/.test(key)) { r.nm = 1; if (v && !r.fn) r.fn = v.slice(0, 100); }
      else if (ac === 'family name' || (/\\bnom\\b|last|surname|family|\\blname\\b/.test(key) && !/complet/.test(key))) { r.nm = 1; if (v && !r.ln) r.ln = v.slice(0, 100); }
      else if (ac === 'name' || (/\\bname\\b|display name|full ?name|nom complet/.test(key) && !/user|company|societe|entreprise/.test(key))) { r.nm = 1; if (v && !full) full = v; }
      else r.ox++;
    }
    if (full && !r.fn && !r.ln) { var sp = full.indexOf(' '); r.fn = (sp > 0 ? full.slice(0, sp) : full).slice(0, 100); if (sp > 0) r.ln = full.slice(sp + 1).slice(0, 100); }
    return r;
  }
  /** null = not an action (password reset, checkout / payment). */
  function classify(form, F, bt) {
    var own = norm([form.getAttribute('id'), form.getAttribute('class'), form.getAttribute('name'), form.getAttribute('action'), bt].join(' '));
    var local = own + ' ' + norm(heading(form)), wide = norm(location.pathname + ' ' + document.title);
    // Not an action: password reset, unsubscribe, account / profile edit (page words only when no password, so the
    // login and signup forms of a « Mon compte » page still count), password change.
    if (RESET.test(local + ' ' + wide) || UNSUB.test(local + ' ' + wide) ||
      PROFILE.test(local.replace(MINE, '')) || (!F.pw && PROFILE.test(wide.replace(MINE, '')))) return null;
    if (F.cur && F.pw >= 2) return null;
    // Checkout: the form's own words or address / card fields; the page's words only for a big form (not the footer newsletter).
    if (F.shop || SHOP.test(own) || (F.n > 3 && SHOP.test(wide))) return null;
    if (F.pw >= 2) return 'signup';
    if (F.pw === 1) {
      if (SIGNUP.test(local)) return 'signup';
      if (LOGIN.test(local)) return 'login';
      if (SIGNUP.test(wide)) return 'signup';
      if (LOGIN.test(wide)) return 'login';
      return F.nm || F.tel ? 'signup' : 'login';
    }
    if (F.ta) return 'contact';
    if (F.ox) return 'form';
    // Email alone (+ names / checkboxes): a newsletter, unless the form itself speaks of signing in (magic link).
    return !F.nm && LOGIN.test(local) ? 'login' : 'newsletter';
  }
  function errors(form) {
    if (form.querySelector('[aria-invalid=true]')) return true;
    // Field by field, no checkValidity() (it fires 'invalid' events); an empty required field is not an error
    // (forms are often reset after success).
    if (!form.hasAttribute('novalidate')) {
      for (var j = 0, els = form.elements || []; j < els.length; j++) {
        var va = els[j].validity;
        if (va && !va.valid && !va.valueMissing && els[j].type !== 'hidden' && shown(els[j])) return true;
      }
    }
    var roots = [form], box = form.parentNode;
    if (box && box !== document.body && box.querySelectorAll) roots.push(box);
    for (var r = 0; r < roots.length; r++) {
      var l = roots[r].querySelectorAll(ERR);
      for (var i = 0; i < l.length; i++) {
        if (!l[i].contains(form) && !/^(INPUT|SELECT|TEXTAREA)$/.test(l[i].tagName) && txt(l[i]) && shown(l[i])) return true;
      }
    }
    return false;
  }
  function onAct(e) {
    var form = e.target;
    if (!form || !form.querySelectorAll || !form.getAttribute || form.__pingsell || form.hasAttribute('data-pingsell')) return;
    if (form.closest && form.closest('[data-pingsell-form]')) return;
    var o = norm(form.getAttribute('data-pingsell-action'));
    if (o === 'ignore') return;
    if (TRACK.consent && !granted) return;
    var F = scrape(form);
    if (!F.e) return;
    if (KINDS[o] !== 1 && ((form.closest && form.closest('[role=search]')) || (F.n === 1 && F.q))) return;
    var btn = e.submitter || form.querySelector('[type=submit],button:not([type])');
    var bt = btn ? (txt(btn) || btn.value || '').slice(0, 120) : '';
    var label = form.getAttribute('data-pingsell-name'), kind = KINDS[o] === 1 ? o : classify(form, F, bt);
    if (!kind) return;
    var P = { id: Math.random().toString(36).slice(2), t: Date.now(), a: kind, f: formKey(form),
      l: (label || heading(form) || bt || form.getAttribute('id') || '').slice(0, 120),
      u: (location.protocol + '//' + location.host + mask(here())).slice(0, 1000),
      pu: here(), e: F.e, fn: F.fn, ln: F.ln, ph: F.ph };
    var m = pend(); m[P.f] = P; keep(m);
    setTimeout(function () { verify(form, F.el, P.f, P.id); }, 400);
  }
  /** 400 ms after the submit: errors shown → forget it; else wait for a sign of success. */
  function verify(form, mail, f, id) {
    var m = pend(), P = m[f];
    if (!P || P.id !== id) return;
    if (document.documentElement.contains(form) && errors(form)) return drop(f, id);
    P.ok = 1; keep(m);
    if (here() !== P.pu) return land(f, id);
    (function watch() {
      var Q = pend()[f];
      if (!Q || Q.id !== id) return;
      if (!document.documentElement.contains(form) || !shown(form) || (mail && !mail.value)) return land(f, id);
      if (errors(form)) return drop(f, id);
      if (Date.now() < P.t + 2e4) setTimeout(watch, 500);
    })();
  }
  /** Single-page navigation away from the form's page: the submission went through. */
  function settle() {
    var m = pend();
    for (var f in m) if (m[f] && m[f].ok && m[f].pu !== here()) land(f, m[f].id);
  }
  /** New page in the tab: an action submitted on another page (or whose form is gone) succeeded. */
  function resume() {
    var m = pend();
    for (var f in m) {
      var P = m[f], seen = false;
      if (!P || P.t >= started) continue;
      if (Date.now() - P.t > LIFE) { drop(f); continue; }
      if (P.pu === here()) for (var i = 0; i < document.forms.length; i++) if (formKey(document.forms[i]) === f) seen = true;
      if (seen) drop(f, P.id); else land(f, P.id);
    }
  }

  if (TRACK.on) {
    if (ACT) {
      document.addEventListener('submit', onAct, true);
      if (document.readyState === 'complete') setTimeout(resume, 1000); else window.addEventListener('load', function () { setTimeout(resume, 1000); });
    }
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
    var navigated = function () { setTimeout(page, 400); setTimeout(settle, 450); };
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
