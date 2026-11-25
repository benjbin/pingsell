# Pingsell — API

API REST, worker d'envoi et tracking de Pingsell (email marketing). Contrat : `../../SPEC.md`.

Stack : Node 25 · TypeScript (exécuté par `tsx`) · Fastify 5 · `node:sqlite` (aucune dépendance native) · zod.

## Démarrage

```bash
cd apps/api
npm install
cp .env.example .env      # facultatif : valeurs par défaut utilisables telles quelles
npm run seed              # données de démo (réinitialise le compte démo)
npm run dev               # http://localhost:4000 (rechargement à chaud)
```

| Script | Rôle |
|---|---|
| `npm run dev` | serveur + worker, `tsx watch` |
| `npm start` | serveur + worker, sans watch |
| `npm run seed` | compte démo, contacts, segments, campagnes, automatisations |
| `npm run typecheck` | `tsc --noEmit` |

Compte démo (valeurs de test) : `demo@missive.local` / `demo1234`, clé API `msv_dev_key_123`.

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@missive.local","password":"demo1234"}' | jq -r .token)
curl -s localhost:4000/api/v1/stats/overview -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/api/v1/contacts -H "Authorization: Bearer msv_dev_key_123"
```

## Architecture

```
src/
  server.ts            point d'entrée : DB + migrations, Fastify, worker
  app.ts               construction de l'app (CORS, parseurs, erreurs, routes, module Shopify)
  config.ts            lecture de .env (process.loadEnvFile)
  db.ts                node:sqlite, migrations (PRAGMA user_version), helpers
  worker.ts            boucle setInterval : campagnes programmées → file → envoi limité → statut
  routes/              auth, api-keys, contacts, segments, campaigns, automations, stats/templates/outbox/integrations, tracking
  services/
    auth.ts            scrypt, sessions, clés API, requireAuth
    contacts.ts        upsert, normalisation, événements
    segments.ts        règles → SQL paramétré (jamais d'interpolation de valeurs)
    campaigns.ts       audience, mise en file, statistiques
    automations.ts     fireTrigger + avancement des étapes (wait / email)
    render.ts          merge tags, réécriture des liens, pixel, pied de page de désinscription
    mailer.ts          fournisseurs : log (dev) et Amazon SES v2
    stats.ts           vue d'ensemble, usage mensuel
    templates.ts       génération d'email à partir de modèles locaux
  integrations/
    context.ts         IntegrationContext (contrat core ↔ modules)
    shopify/           module Shopify (propriété de l'agent Shopify)
  seed.ts
```

### Envoi

- `POST /campaigns/:id/send` passe la campagne en `sending` et réveille le worker.
- Le worker crée un message par destinataire abonné (segment ou toute la base), rendu individuellement :
  merge tags `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{unsubscribe_url}}` (avec valeur par défaut :
  `{{first_name|cher client}}`), liens réécrits vers `/t/c/:id`, pixel `/t/o/:id.gif`, pied de page de
  désinscription ajouté si `{{unsubscribe_url}}` est absent.
- Envoi par lots (`SEND_BATCH_SIZE`) à `SEND_RATE_PER_SECOND` maximum, puis campagne `sent` (ou `failed`).
- `EMAIL_PROVIDER=log` : rien ne sort de la machine, consultez `GET /api/v1/outbox`.
  `EMAIL_PROVIDER=ses` : SES v2 `SendEmail` (identifiants via la chaîne AWS standard, en-têtes
  `List-Unsubscribe` + one-click RFC 8058).

### Automatisations

`fireTrigger` crée des `automation_runs` pour chaque automatisation active correspondante
(`trigger_config.tag` pour `tag_added`, `trigger_config.min_total` optionnel pour `order_created`).
Le worker enchaîne les étapes `email` et reprogramme sur les étapes `wait`. Garde-fous : une seule
série `contact_created` par contact, pas de doublon tant qu'un run est en cours, une commande annule
les relances de panier abandonné, un désabonnement annule les runs en cours.

### Webhooks sortants

L'étape `webhook` d'une automatisation n'appelle pas l'URL directement : l'appel est écrit dans la table
`webhook_outbox` (dans la même transaction que l'étape), puis envoyé par le worker (`takeWebhooks` →
`sendWebhooks`). Un appel est donc envoyé au moins une fois, même si le processus redémarre.

- `POST` JSON `{ automation, contact, event, sent_at }`, en-têtes `Content-Type: application/json`,
  `User-Agent: Pingsell-Webhook/1.0`, `Pingsell-Webhook-Id` (identique à chaque nouvel essai : sert à dédoublonner),
  `Pingsell-Signature: t=<horodatage unix>,v1=<hex>`.
- Signature : `v1 = HMAC-SHA256(secret, "<t>.<corps brut>")` en hexadécimal. Le secret (`whsec_…`, un par compte)
  est affiché dans `GET /api/v1/inbound` (`outgoing_webhooks.signing_secret`) et renouvelé par
  `POST /api/v1/inbound/outgoing-webhooks/rotate`. Côté récepteur : recalculer la signature sur le corps brut,
  la comparer en temps constant et refuser un `t` de plus de 5 minutes.
  ```js
  const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
  const ok = crypto.timingSafeEqual(Buffer.from(v1, 'hex'), crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest());
  ```
- Réponse 2xx = reçu. Erreur réseau, délai dépassé (5 s), `408`, `429` ou `5xx` : nouvel essai après 1 min, 5 min,
  30 min, 2 h puis 6 h, ensuite l'appel est marqué `failed`. Autre code (`4xx`, redirection) : `failed` tout de suite.
- Sécurité : HTTPS ou HTTP public uniquement. L'adresse est résolue une fois et la connexion part vers cette IP
  (pas de rebinding DNS), les adresses privées / locales sont refusées (`ALLOW_PRIVATE_WEBHOOKS=1` pour le
  développement), les redirections ne sont pas suivies.
- Historique : les appels envoyés sont effacés après 2 jours, les échecs après 14 jours.

### Tracking public

`GET /t/o/:messageId.gif` · `GET /t/c/:messageId?u=` (redirige uniquement vers une URL présente dans
le message : pas d'open redirect) · `GET /u/:messageId` (page de désinscription) · `POST /u/:messageId`
(one-click) · `GET /health`.

## Notes et écarts mineurs vis-à-vis de SPEC.md

- `messages.contact_id` est nullable (envois de test vers une adresse hors base, historique conservé
  après suppression d'un contact). Les envois de test ne sont rattachés à aucune campagne.
- `POST /contacts/import` renvoie `errors` (nombre) et `error_details` (100 premières lignes en erreur).
  L'import ne déclenche pas les automatisations sauf `trigger_automations: true`.
- `upsertContact` (contexte d'intégration) ne déclenche aucune automatisation : l'appelant appelle
  `fireTrigger` (comme le font les routes et le module Shopify).
- Champs supplémentaires : `GET /api-keys` renvoie `key_preview` (jamais la clé complète), `POST /contacts`
  renvoie `created`, `GET /automations/:id` renvoie `recent_runs`, `POST /templates/generate-email` renvoie
  `source: 'ai' | 'template'`, `GET /outbox` renvoie `provider`. `POST /auth/logout` existe en plus.
- Les routes Shopify répondent aussi sans préfixe (`/webhooks/shopify` ⇄ `/api/v1/webhooks/shopify`).
- `revenue_shopify` = somme de `data.total` des événements `order` sur la période.
