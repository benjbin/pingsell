/**
 * The script a merchant pastes on any site (Wix, Squarespace, Framer, Webflow, WordPress, Shopify, Carrd…):
 *
 *   <div data-pingsell-form data-title="Restez au courant" data-tags="newsletter"></div>
 *   <script src="https://…/api/v1/public/forms/pk_…/embed.js" async></script>
 *
 * - renders a styled signup form in every `[data-pingsell-form]` (Shadow DOM: the site's CSS can't break it);
 * - sends any existing `<form data-pingsell>` to Pingsell (the site's own design, any field names);
 * - exposes `Pingsell.track('commande', { email, id, total })` for order-confirmation / booking pages.
 * Plain ES5, no dependency, ~4 KB.
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
