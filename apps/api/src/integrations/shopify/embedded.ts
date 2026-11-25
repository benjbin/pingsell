// The page Shopify shows inside its admin when the merchant opens Pingsell (embedded app, App Bridge).
// It holds no secret and stores nothing in the browser: every call carries an App Bridge session token.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function embeddedPage(opts: { apiKey: string; apiBase: string; webUrl: string; lang: 'fr' | 'en' }): string {
  const { apiKey, apiBase, webUrl, lang } = opts;
  const fr = lang === 'fr';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="shopify-api-key" content="${esc(apiKey)}">
<title>Pingsell</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<style>
  :root { --bg:#f1f1f1; --card:#fff; --text:#303030; --muted:#616161; --line:#e3e3e3; --brand:#4f46e5; --ok:#047b5d; --warn:#8a6116; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 20px 16px 40px; }
  .head { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
  .head img { width:40px; height:40px; border-radius:10px; }
  .head h1 { font-size:20px; margin:0; font-weight:650; }
  .head p { margin:2px 0 0; color:var(--muted); }
  .card { background:var(--card); border-radius:12px; box-shadow:0 1px 0 rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.04); padding:16px; margin-bottom:16px; }
  .card h2 { font-size:15px; margin:0 0 4px; font-weight:650; }
  .muted { color:var(--muted); }
  .badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:2px 10px; border-radius:999px; }
  .badge.ok { background:#cdfee1; color:var(--ok); } .badge.warn { background:#fff1c7; color:var(--warn); }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:12px; margin-top:12px; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:12px; }
  .stat b { display:block; font-size:22px; font-weight:650; margin-top:2px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
  button { font:inherit; font-weight:600; border-radius:8px; padding:8px 14px; cursor:pointer; border:1px solid var(--line); background:#fff; color:var(--text); }
  button.primary { background:#303030; color:#fff; border-color:#303030; }
  ul.steps { margin:8px 0 0; padding-left:18px; } ul.steps li { margin:4px 0; }
  .skeleton { height:14px; background:#e9e9e9; border-radius:6px; margin:8px 0; }
</style>
</head>
<body>
<main>
  <div class="head">
    <img src="${esc(webUrl)}/apple-touch-icon.png" alt="">
    <div><h1>Pingsell</h1><p>${fr ? 'Emails, notifications push et relances automatiques pour votre boutique.' : 'Emails, push notifications and automated follow-ups for your store.'}</p></div>
  </div>
  <div id="root"><div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div></div>
</main>
<script>
(function () {
  var FR = ${fr ? 'true' : 'false'};
  var t = function (a, b) { return FR ? a : b; };
  var root = document.getElementById('root');
  // Back from Shopify's plan page (plan_handle in the URL): read the plan again instead of the cached one.
  var REFRESH = /[?&]plan_handle=/.test(location.search);
  var nf = new Intl.NumberFormat(FR ? 'fr-FR' : 'en-US');
  function money(v, cur) { try { return new Intl.NumberFormat(FR ? 'fr-FR' : 'en-US', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(v || 0); } catch (e) { return nf.format(v || 0); } }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function open(url) { window.open(url, '_blank', 'noopener'); }
  // Shopify's plan page lives outside the app frame: open it in the whole admin window.
  function top(url) { window.open(url, '_top'); }
  window.__open = open;
  window.__top = top;
  var PLANS = { free: t('Gratuit', 'Free'), pro: 'Pro', business: 'Business' };
  function date(v) { try { return new Date(v).toLocaleDateString(FR ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long' }); } catch (e) { return ''; } }
  function planCard(p) {
    if (!p) return '';
    var name = p.id ? PLANS[p.id] || p.id : t('indisponible pour le moment', 'unavailable right now');
    var note = p.trial_ends_at ? t('Essai gratuit jusqu’au ', 'Free trial until ') + date(p.trial_ends_at) + '.'
      : p.cancel_at_end ? t('Changement prévu à la fin de la période en cours.', 'Change scheduled at the end of the current period.') : '';
    return '<div class="card"><h2>' + t('Votre formule : ', 'Your plan: ') + h(name) + '</h2>' +
      (note ? '<p class="muted">' + h(note) + '</p>' : '<p class="muted">' + t('Facturée par Shopify, sur votre facture Shopify.', 'Billed by Shopify, on your Shopify bill.') + '</p>') +
      '<div class="row"><button onclick="__top(\\'' + h(p.pricing_url) + '\\')">' + t('Changer de formule', 'Change plan') + '</button></div></div>';
  }

  function render(d) {
    if (d.state === 'connected') {
      var s = d.stats || {};
      root.innerHTML =
        '<div class="card"><span class="badge ok">● ' + t('Connectée', 'Connected') + '</span>' +
        '<h2 style="margin-top:10px">' + h(d.shop_name) + ' → ' + t('compte Pingsell', 'Pingsell account') + ' « ' + h(d.account_name) + ' »</h2>' +
        '<p class="muted">' + t('Vos clients, commandes et paniers abandonnés arrivent dans Pingsell automatiquement.', 'Your customers, orders and abandoned carts reach Pingsell automatically.') + '</p>' +
        '<div class="stats">' +
          '<div class="stat"><span class="muted">' + t('Clients synchronisés', 'Customers synced') + '</span><b>' + nf.format(s.contacts || 0) + '</b></div>' +
          '<div class="stat"><span class="muted">' + t('Abonnés aux emails', 'Email subscribers') + '</span><b>' + nf.format(s.subscribed || 0) + '</b></div>' +
          '<div class="stat"><span class="muted">' + t('Ventes sur 30 jours', 'Sales, last 30 days') + '</span><b>' + money(s.revenue, d.currency) + '</b></div>' +
          '<div class="stat"><span class="muted">' + t('Campagnes envoyées (30 j)', 'Campaigns sent (30 d)') + '</span><b>' + nf.format(s.campaigns || 0) + '</b></div>' +
        '</div>' +
        '<div class="row"><button class="primary" onclick="__open(\\'' + h(d.links.campaigns) + '\\')">' + t('Créer une campagne', 'Create a campaign') + '</button>' +
        '<button onclick="__open(\\'' + h(d.links.automations) + '\\')">' + t('Automatisations', 'Automations') + '</button>' +
        '<button onclick="__open(\\'' + h(d.links.home) + '\\')">' + t('Ouvrir Pingsell', 'Open Pingsell') + '</button></div></div>' +
        planCard(d.plan) +
        (d.sync && d.sync.running ? '<div class="card muted">' + t('Synchronisation en cours… les chiffres se mettent à jour.', 'Syncing… numbers are updating.') + '</div>' : '');
      if (d.sync && d.sync.running) setTimeout(load, 5000);
      return;
    }
    if (d.state === 'choose_plan') {
      root.innerHTML =
        '<div class="card"><span class="badge warn">● ' + t('Dernière étape', 'Last step') + '</span>' +
        '<h2 style="margin-top:10px">' + t('Choisissez votre formule Pingsell', 'Choose your Pingsell plan') + '</h2>' +
        '<p class="muted">' + t('La formule est facturée par Shopify. Vous pouvez en changer à tout moment.', 'Your plan is billed by Shopify. You can change it at any time.') + '</p>' +
        '<div class="row"><button class="primary" onclick="__top(\\'' + h(d.pricing_url) + '\\')">' + t('Voir les formules', 'See plans') + '</button></div></div>';
      top(d.pricing_url);
      return;
    }
    if (d.state === 'claim') {
      root.innerHTML =
        '<div class="card"><span class="badge warn">● ' + t('Dernière étape', 'Last step') + '</span>' +
        '<h2 style="margin-top:10px">' + t('Reliez ', 'Link ') + h(d.shop_name) + t(' à votre compte Pingsell', ' to your Pingsell account') + '</h2>' +
        '<ul class="steps"><li>' + t('Connectez-vous ou créez votre compte Pingsell (gratuit).', 'Log in or create your Pingsell account (free).') + '</li>' +
        '<li>' + t('Votre boutique est reliée en un clic, puis vos clients et commandes sont importés.', 'Your store is linked in one click, then your customers and orders are imported.') + '</li>' +
        '<li>' + t('Revenez ici : vos chiffres s’afficheront.', 'Come back here: your numbers will show.') + '</li></ul>' +
        '<div class="row"><button class="primary" onclick="__open(\\'' + h(d.claim_url) + '\\')">' + t('Relier ma boutique', 'Link my store') + '</button>' +
        '<button onclick="location.reload()">' + t('C’est fait, actualiser', 'Done, refresh') + '</button></div></div>';
      return;
    }
    root.innerHTML = '<div class="card"><h2>' + t('Impossible de charger Pingsell', 'Couldn’t load Pingsell') + '</h2><p class="muted">' + h(d.error || '') + '</p>' +
      '<div class="row"><button onclick="location.reload()">' + t('Réessayer', 'Try again') + '</button></div></div>';
  }

  async function load() {
    try {
      var token = await shopify.idToken();
      var res = await fetch(${JSON.stringify(apiBase)} + '/integrations/shopify/embedded', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: REFRESH }) });
      REFRESH = false;
      var data = await res.json().catch(function () { return {}; });
      render(res.ok ? data : { state: 'error', error: data.error || ('HTTP ' + res.status) });
    } catch (e) {
      render({ state: 'error', error: e && e.message });
    }
  }
  load();
})();
</script>
</body>
</html>`;
}
