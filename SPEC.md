# Missive — plateforme d'email marketing (spec MVP)

Nom de code : **Missive** (renommable). Plateforme d'email marketing, prix au volume d'emails,
intégration Shopify, API publique, app mobile. Aucun service d'IA tiers dans le produit.

This file is THE contract between all apps. Every app must follow it exactly. UI language: **French**.

## Monorepo layout (no npm workspaces — each app is an independent npm package with its own node_modules)

| Folder | What | Stack | Port |
|---|---|---|---|
| `apps/api` | REST API + sending worker + tracking | Node 25, TypeScript run with `tsx`, Fastify 5, `node:sqlite` (built-in, NO native deps), zod | 4000 |
| `apps/api/src/integrations/shopify` | Shopify integration module (owned by the Shopify agent) | same as api, **no extra deps** (use fetch + node:crypto) | — |
| `apps/web` | Back-office dashboard | React 19 + Vite + TypeScript + Tailwind v4 (`@tailwindcss/vite`) + react-router + recharts | 5173 |
| `apps/mobile` | Mobile app | Expo (latest SDK) + expo-router + TypeScript | — |

No Docker, no Postgres, no Redis on this machine. Everything must run with `npm install && npm run dev` per app.

## Environment

`apps/api/.env.example` (api loads `.env` with `process.loadEnvFile` if present):
```
PORT=4000
DATABASE_PATH=./missive.db
PUBLIC_URL=http://localhost:4000        # used in tracking links
WEB_URL=http://localhost:5173           # CORS origin
EMAIL_PROVIDER=log                       # log | ses
AWS_REGION=eu-west-3                     # if ses
SHOPIFY_API_KEY=                         # optional, for OAuth public-app flow
SHOPIFY_API_SECRET=
```
Web: `VITE_API_URL` default `http://localhost:4000`.

## Demo seed (test values only)
`npm run seed` in apps/api creates: account "Boutique Démo", login `demo@missive.local` / `demo1234`,
API key `msv_dev_key_123`, ~60 contacts (varied tags, spend, statuses), 3 segments, 4 campaigns (2 sent with
fake messages/opens/clicks spread over the last 30 days so charts look real), 2 automations.

## Auth
- `Authorization: Bearer <token>` where token is either a session token (from login) or an API key (`msv_…`).
- Both resolve to an `account_id`. All data is scoped by account (multi-tenant).
- Passwords hashed with `node:crypto` scrypt.

## Data model (SQLite; ids are TEXT uuid via crypto.randomUUID(); dates are ISO strings; JSON columns are TEXT)
- `accounts(id, name, email UNIQUE, password_hash, created_at)`
- `sessions(token PK, account_id, created_at)`
- `api_keys(id, account_id, key UNIQUE, label, created_at, last_used_at)`
- `contacts(id, account_id, email, first_name, last_name, phone, tags JSON string[], attributes JSON object, status 'subscribed'|'unsubscribed'|'bounced'|'complained', source 'manual'|'import'|'shopify'|'api', external_id, total_spent REAL, orders_count INT, last_order_at, created_at, updated_at, UNIQUE(account_id,email))`
- `segments(id, account_id, name, rules JSON, created_at, updated_at)`
- `campaigns(id, account_id, name, subject, preheader, from_name, from_email, html, segment_id NULL=all subscribed, status 'draft'|'scheduled'|'sending'|'sent'|'failed', scheduled_at, sent_at, created_at, updated_at)`
- `messages(id, account_id, campaign_id NULL, automation_id NULL, contact_id, to_email, subject, html, status 'queued'|'sent'|'failed'|'bounced', provider_id, error, sent_at, opened_at, clicked_at, created_at)`
- `events(id, account_id, contact_id, type 'open'|'click'|'unsubscribe'|'bounce'|'order'|'cart_abandoned'|'tag_added'|'contact_created', data JSON, created_at)`
- `automations(id, account_id, name, trigger 'contact_created'|'tag_added'|'order_created'|'cart_abandoned', trigger_config JSON (e.g. {"tag":"vip"}), steps JSON, status 'active'|'paused', created_at, updated_at)`
  - steps: `[{ "type":"wait", "hours": 24 } | { "type":"email", "subject":"...", "html":"..." }]`
- `automation_runs(id, automation_id, contact_id, step_index, next_run_at, status 'pending'|'done'|'cancelled', created_at)`
- `integrations(id, account_id, provider 'shopify', shop_domain, access_token, status 'connected'|'error', config JSON, last_sync_at, created_at, UNIQUE(account_id, provider))`

### Segment rules
```json
{ "match": "all" | "any", "conditions": [ { "field": "...", "op": "...", "value": ... } ] }
```
fields: `email, first_name, last_name, status, source, tags, total_spent, orders_count, last_order_at, created_at`
ops: `eq, neq, contains, gt, lt` (text/number), `has_tag, not_has_tag` (tags), `within_days, older_than_days` (dates; value = number of days).
Segments only ever target contacts matching rules; sending always additionally requires `status='subscribed'`.

## Merge tags in subject/html
`{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{unsubscribe_url}}`. API rewrites links for click tracking and appends an open pixel + unsubscribe footer if `{{unsubscribe_url}}` is absent.

## REST API — base `/api/v1`, JSON, errors `{ "error": "message" }` with proper status codes
List endpoints return `{ data: T[], total, page, limit }` (query `page` default 1, `limit` default 50, max 200).

Auth
- `POST /auth/register {name, email, password}` → `{ token, account }`
- `POST /auth/login {email, password}` → `{ token, account }`
- `GET /me` → `{ account: {id,name,email,created_at}, usage: { emails_sent_month, contacts } }`

API keys
- `GET /api-keys` · `POST /api-keys {label}` → full key shown once · `DELETE /api-keys/:id`

Contacts
- `GET /contacts?search=&tag=&status=&segment_id=&page=&limit=`
- `POST /contacts {email, first_name?, last_name?, phone?, tags?, attributes?, status?}` (upsert on email) — fires `contact_created` when new
- `GET /contacts/:id` → contact + `events` (last 50) + `messages` (last 20)
- `PATCH /contacts/:id` · `DELETE /contacts/:id`
- `POST /contacts/:id/tags {add?: string[], remove?: string[]}` — fires `tag_added` per added tag
- `POST /contacts/import {contacts: ContactInput[]} | {csv: string}` → `{ created, updated, errors }`
- `GET /tags` → `{ data: [{tag, count}] }`

Segments
- `GET /segments` (each with `count`) · `POST /segments {name, rules}` · `GET/PATCH/DELETE /segments/:id`
- `POST /segments/preview {rules}` → `{ count, sample: Contact[] (max 10) }`

Campaigns
- `GET /campaigns?status=` (each with `stats`) · `POST /campaigns {name, subject, preheader?, from_name?, from_email?, html?, segment_id?}`
- `GET/PATCH/DELETE /campaigns/:id` (only drafts editable)
- `POST /campaigns/:id/test {to}` → sends one test email
- `POST /campaigns/:id/send` → status `sending`, worker queues + sends → `sent`
- `POST /campaigns/:id/schedule {scheduled_at}` · `POST /campaigns/:id/unschedule`
- `GET /campaigns/:id/stats` → `{ recipients, sent, failed, opened, clicked, unsubscribed, open_rate, click_rate, timeline: [{hour, opens, clicks}] }`
- campaign `stats` object = `{ recipients, sent, opened, clicked, open_rate, click_rate }` (rates are 0..1)

Automations
- `GET /automations` (each with `runs_active`, `emails_sent`) · `POST /automations {name, trigger, trigger_config?, steps}` · `GET/PATCH/DELETE /automations/:id`
- `POST /automations/:id/activate` · `POST /automations/:id/pause`

Stats
- `GET /stats/overview?days=30` → `{ contacts_total, contacts_subscribed, contacts_new, campaigns_sent, emails_sent, open_rate, click_rate, unsubscribe_rate, revenue_shopify, timeseries: [{date, sent, opened, clicked}] }`

Templates
- `POST /templates/generate-email {prompt, tone?, brand?}` → `{ subject, preheader, html, source: 'template' }`. Deterministic local template library (theme picked from the brief). No external AI service.

Dev outbox
- `GET /outbox?limit=20` → last messages incl. html (only meaningful with EMAIL_PROVIDER=log)

Integrations (core)
- `GET /integrations` → `{ data: Integration[] }` (never return access_token, return `connected: true`)

Shopify (implemented in `src/integrations/shopify`, mounted by core)
- `POST /integrations/shopify/connect {shop_domain, access_token}` (custom-app Admin API token) → validates via Shopify, stores, registers webhooks, starts initial sync
- `GET /integrations/shopify/install?shop=` + `GET /integrations/shopify/callback` (OAuth, only if SHOPIFY_API_KEY set; callback is public)
- `POST /integrations/shopify/sync` → `{ customers, orders }`
- `DELETE /integrations/shopify`
- `POST /webhooks/shopify` (public, HMAC verified with SHOPIFY_API_SECRET or per-integration secret; topic from `X-Shopify-Topic`): `customers/create|update`, `orders/create`, `checkouts/create|update` (abandoned cart → `cart_abandoned` after 1h without order), `app/uninstalled`
- `POST /integrations/shopify/simulate {type: 'order'|'cart_abandoned', email}` → dev helper to test automations without a real store

Public tracking (no auth, no /api/v1 prefix)
- `GET /t/o/:messageId.gif` (1x1 gif, records open once) · `GET /t/c/:messageId?u=<encoded url>` (records click, 302) · `GET /u/:messageId` (unsubscribe page in French + sets status) · `GET /health` → `{ok:true}`

## Core ↔ Shopify module interface (fixed)
`apps/api/src/integrations/shopify/index.ts` exports:
```ts
export async function registerShopify(app: FastifyInstance, ctx: IntegrationContext): Promise<void>
```
`IntegrationContext` is defined by core in `apps/api/src/integrations/context.ts`:
```ts
export interface IntegrationContext {
  db: DatabaseSync;                                   // node:sqlite
  requireAuth: preHandlerHookHandler;                 // sets request.accountId
  upsertContact(accountId: string, input: { email: string; first_name?: string; last_name?: string; phone?: string; tags?: string[]; source?: string; external_id?: string; total_spent?: number; orders_count?: number; last_order_at?: string; status?: string }): { contact: any; created: boolean };
  recordEvent(accountId: string, contactId: string, type: string, data?: object): void;
  fireTrigger(accountId: string, contactId: string, trigger: 'contact_created'|'tag_added'|'order_created'|'cart_abandoned', data?: object): void;
  config: { publicUrl: string; shopifyApiKey?: string; shopifyApiSecret?: string };
}
```
Core declares `request.accountId` on FastifyRequest. Shopify module creates nothing outside its folder and uses the `integrations` table defined above (core creates it).
Fastify must register a raw-body capable JSON parser so webhook HMAC can be verified: core stores `request.rawBody` (string) for every JSON request.

## Design direction (web + mobile)
Clean, premium SaaS. Accent violet `#6D28D9`, neutrals slate, rounded-xl cards, generous spacing, Inter font. Light + dark mode. French copy.
