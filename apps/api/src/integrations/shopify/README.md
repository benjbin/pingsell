# Intégration Shopify — Pingsell

Module monté par l'API (`registerShopify(app, ctx)`), sans dépendance npm : `fetch` global + `node:crypto`.
Version d'API Shopify : **2026-07** (constante `SHOPIFY_API_VERSION` dans `types.ts`).

## Autorisations (scopes) nécessaires

| Scope | Pourquoi |
|---|---|
| `read_customers` | synchronisation des clients, webhooks `customers/create` et `customers/update` |
| `read_orders` | synchronisation des commandes, webhook `orders/create` et webhooks `checkouts/create` / `checkouts/update` (paniers abandonnés) |

Il n'existe pas de scope `read_checkouts` : les webhooks de checkout demandent `read_orders`.
Sans `read_all_orders`, Shopify ne renvoie que les commandes des 60 derniers jours (suffisant pour démarrer).
Les données clients sont des « données client protégées » : une app publique doit en demander l'accès dans
le Dev Dashboard. Pour une app de la boutique elle-même, il suffit de les activer dans sa configuration.

## Connecter une boutique

### 1. Jeton Admin API d'une app personnalisée existante (`shpat_…`)

Depuis le 1er janvier 2026, Shopify ne permet plus de **créer** des apps personnalisées dans l'admin.
Celles qui existent déjà marchent toujours (elles s'affichent comme « legacy custom apps ») :

1. Admin Shopify → **Paramètres → Applications et canaux de vente → Développer des applications** → votre app.
2. Onglet **Configuration** : cochez `read_customers` et `read_orders` dans les scopes Admin API, puis enregistrez.
3. Onglet **Identifiants de l'API** : révélez le **jeton d'accès Admin API** (une seule fois) et copiez aussi la
   **clé secrète de l'API**. Cette clé sert à vérifier la signature des webhooks.
4. Dans Pingsell : `POST /api/v1/integrations/shopify/connect`
   ```json
   { "shop_domain": "ma-boutique.myshopify.com", "access_token": "shpat_…", "api_secret": "…" }
   ```

### 2. App du Dev Dashboard (nouvelle méthode, recommandée pour votre propre boutique)

1. Sur https://dev.shopify.com, créez une app et une version avec les scopes `read_customers` et `read_orders`, puis installez-la
   sur votre boutique. L'app et la boutique doivent appartenir à la même organisation.
2. Copiez le **Client ID** et le **Client secret**.
3. `POST /api/v1/integrations/shopify/connect`
   ```json
   { "shop_domain": "ma-boutique.myshopify.com", "client_id": "…", "client_secret": "…" }
   ```
   Pingsell obtient le jeton avec le *client credentials grant*. Ce jeton expire au bout de 24 h, et Pingsell
   le renouvelle tout seul. Le client secret sert aussi à vérifier la signature des webhooks.

### 3. App publique (méthode principale, Shopify App Store)

Variables d'environnement : `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (identifiants de l'app du Dev Dashboard) et
`SHOPIFY_APP_INSTALL_URL` (fiche App Store, ex. `https://apps.shopify.com/pingsell`, une fois l'app publiée : c'est le lien
du bouton « Installer Pingsell sur Shopify »). La configuration Shopify de l'app est dans
`integrations/shopify-app/shopify.app.toml`.

Parcours conforme aux règles de l'App Store (installation lancée depuis Shopify, OAuth immédiat, jamais de domaine à taper) :

1. Shopify ouvre `GET /api/v1/integrations/shopify/app?shop=…&hmac=…` (application_url). La route vérifie le HMAC.
   Si la boutique est déjà connectée, elle redirige vers l'app (`/integrations?outil=shopify`), sinon directement vers
   l'écran d'autorisation Shopify.
2. `GET /api/v1/integrations/shopify/callback` vérifie le HMAC et le `state` (usage unique, 10 min), puis échange le code avec
   `expiring=1` : jeton offline d'1 h + jeton de renouvellement de 90 jours, qui change à chaque renouvellement
   (obligatoire pour les apps publiques). Le jeton est renouvelé tout seul 5 min avant expiration. Si Shopify refuse le
   renouvellement, l'intégration passe en erreur et le marchand doit rouvrir Pingsell depuis son admin Shopify.
3. Rattachement au compte :
   - installation lancée depuis Pingsell (`/install?shop=`, utile pour les boutiques de test) → le compte connecté ;
   - boutique déjà connue d'un seul compte (réinstallation) → ce compte, redirection vers `/integrations?shopify=connected` ;
   - sinon → le jeton est gardé 24 h dans `shopify_pending_installs` et le navigateur part sur `/shopify/connecter?claim=…`.
     Le marchand se connecte ou crée son compte, puis `GET /integrations/shopify/pending?claim=` et
     `POST /integrations/shopify/claim { claim }` rattachent la boutique (lien à usage unique).

### Confidentialité (webhooks obligatoires)

Déclarés dans `shopify.app.toml` (`compliance_topics`), signés avec `SHOPIFY_API_SECRET` :

| Sujet | Ce que fait Pingsell |
|---|---|
| `customers/data_request` | enregistre la demande dans `shopify_data_requests` (client, commandes demandées, contact Pingsell lié) |
| `customers/redact` | contact venu de Shopify : supprimé avec ses événements. Contact ajouté autrement : on lui retire tout ce qui vient de Shopify (identifiant, commandes, total dépensé, paniers) |
| `shop/redact` | 48 h après la désinstallation : supprime la connexion, les secrets, les paniers, les demandes en attente. Les contacts restent dans le compte Pingsell du marchand, qui peut les supprimer. Ne fait rien si la boutique a été réinstallée entre-temps |

## Ce qui se passe à la connexion

1. Le module valide le jeton et vérifie les scopes avec une requête GraphQL (`shop` + `currentAppInstallation.accessScopes`). Les apps publiques n'ont plus le droit d'utiliser l'API REST.
2. Il enregistre l'intégration dans la table `integrations`. Les secrets vont dans `shopify_credentials`, jamais dans `config`.
3. Il crée les webhooks GraphQL (`webhookSubscriptionCreate`) vers `{PUBLIC_URL}/api/v1/webhooks/shopify`.
   Shopify n'envoie des webhooks qu'à une URL **HTTPS publique**. En local, utilisez un tunnel (cloudflared, ngrok) ou
   l'endpoint de simulation. Sans URL publique, `config.webhooks_error` explique pourquoi.
4. La synchronisation initiale démarre en arrière-plan. L'état est suivi dans `config.sync`.

## Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/integrations/shopify` | état : `{ integration, oauth_available, sync_running }` |
| POST | `/integrations/shopify/connect` | connexion (voir plus haut), renvoie `201 { integration, shop }` |
| POST | `/integrations/shopify/sync` | synchro manuelle, renvoie `{ customers, orders }` (`409` si une synchro tourne déjà) |
| DELETE | `/integrations/shopify` | supprime les webhooks côté Shopify (si possible) et l'intégration, renvoie `{ ok: true }` |
| POST | `/integrations/shopify/simulate` | `{ type: 'order' \| 'cart_abandoned', email, total? }` : outil de dev |
| POST | `/webhooks/shopify` | public, signature HMAC vérifiée |

## Correspondance des données

- Clients : `source: 'shopify'`. Les tags Shopify sont ajoutés aux tags existants. Le module renseigne aussi `total_spent`,
  `orders_count`, `last_order_at` et `external_id` (identifiant numérique Shopify).
- Consentement marketing (`emailMarketingConsent`) → statut du contact :
  - `subscribed` → `subscribed` ;
  - `unsubscribed` / `redacted` → `unsubscribed` ;
  - sans consentement, un **nouveau** contact est créé `unsubscribed` (RGPD) et un contact existant garde son statut ;
  - un contact `bounced` ou `complained` n'est jamais réabonné.
- Commandes : un événement `order` avec `{ order_id, order_name, total, currency, line_items }`.
  - Le webhook `orders/create` déclenche aussi `order_created` et met à jour les totaux du contact.
  - La synchro historique importe les commandes des 365 derniers jours, à leur date d'origine, dédupliquées par `order_id`,
    sans déclencher d'automatisation.
- Paniers abandonnés : les `checkouts/create|update` sont stockés dans `shopify_checkouts`.
  - Si aucune commande n'arrive dans l'heure qui suit la dernière mise à jour du checkout, un vérificateur qui tourne
    chaque minute enregistre `cart_abandoned` et déclenche le trigger `cart_abandoned`.
  - Données transmises : `{ checkout_id, total, currency, checkout_url, line_items }`.
  - Le checkout est considéré comme converti s'il a un `completed_at`, si son token ou son id correspond à une commande,
    ou si le même email passe commande.
- `app/uninstalled` : l'intégration passe en `status: 'error'`, son jeton est effacé et `config.error` explique la déconnexion.
- Les webhooks RGPD obligatoires (`customers/data_request`, `customers/redact`, `shop/redact`) reçoivent une réponse 200.

## Signature des webhooks

`X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(secret, corps brut)), comparé en temps constant (`timingSafeEqual`).
Le module accepte deux secrets : `SHOPIFY_API_SECRET` (app publique) ou le secret propre à l'intégration
(`api_secret` / `client_secret`). Le corps brut est lu par un parseur JSON propre à la route webhook, il n'est jamais re-sérialisé.
Les livraisons rejouées sont ignorées grâce à `X-Shopify-Webhook-Id` (table `shopify_webhook_log`, purge après 7 jours).

## Aides exportées

- `getShopifyRevenue(db, accountId, days?)` → `{ revenue, orders }`
- `getCampaignAttributedRevenue(db, accountId, campaignId, windowDays = 5)` → chiffre d'affaires des destinataires dans les N jours après l'envoi
- `processAbandonedCheckouts(ctx)` : lance une passe du vérificateur à la demande

## Tester sans boutique

```bash
curl -X POST localhost:4000/api/v1/integrations/shopify/simulate \
  -H 'Authorization: Bearer msv_dev_key_123' -H 'Content-Type: application/json' \
  -d '{"type":"cart_abandoned","email":"client@exemple.fr"}'
```
