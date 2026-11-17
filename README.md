# Missive

Plateforme d'email marketing avec un prix basé sur le volume d'emails, une intégration Shopify,
une API publique et une app mobile.

Le contrat entre toutes les apps (modèle de données, API REST, auth, ports, variables d'environnement,
design) est dans [`SPEC.md`](./SPEC.md).

## Vue d'ensemble

| Dossier | Rôle | Stack | Port |
|---|---|---|---|
| `apps/api` | API REST `/api/v1`, worker d'envoi, tracking, automatisations, modèles d'emails | Node 25, Fastify 5, `node:sqlite`, zod, tsx | 4000 |
| `apps/api/src/integrations/shopify` | Module Shopify (connexion, sync, webhooks, paniers abandonnés) | fetch + `node:crypto` | — |
| `apps/web` | Back-office (tableau de bord, contacts, segments, campagnes avec éditeur visuel par blocs, automatisations…) | React 19, Vite, Tailwind v4, recharts | 5173 |
| `apps/mobile` | App mobile (KPI, campagnes, contacts) | Expo + expo-router | Expo Go |

Pas de workspaces npm : chaque app est un package indépendant avec ses propres `node_modules`.
Aucune dépendance système : pas de Docker, Postgres ni Redis (SQLite intégré à Node).

## Architecture

```
        ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
        │  apps/web        │     │  apps/mobile     │     │  Vos outils      │
        │  React (5173)    │     │  Expo            │     │  (API publique)  │
        └────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
                 │ Bearer sess_…          │ Bearer sess_…          │ Bearer msv_… (clé API)
                 ▼                        ▼                        ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │  apps/api — Fastify (4000)                                          │
        │   /api/v1/*  auth · contacts · segments · campagnes · automations   │
        │              stats · modèles · outbox · intégrations                │
        │   /t/o /t/c /u/:id  tracking ouvertures, clics, désinscription       │
        │   /webhooks/shopify  (HMAC)  ◄──────────────── Shopify Admin API    │
        │                                                                     │
        │   Worker (setInterval) : campagnes programmées → messages → envoi   │
        │                          étapes d'automatisation (attente / email)  │
        │   Mailer : log (dev, visible dans /outbox) | Amazon SES v2          │
        └───────────────────────────────┬─────────────────────────────────────┘
                                        ▼
                             SQLite (apps/api/missive.db)
```

## Démarrage rapide

Prérequis : Node 25 (Node ≥ 22.5 suffit pour l'API).

```bash
npm run install:all   # installe les 3 apps
npm run seed          # crée la base de démo (apps/api/missive.db)
npm run dev           # API (http://localhost:4000) + back-office (http://localhost:5173)
```

Autres scripts racine :

- `npm run build` : type-check de l'API, build du web, type-check du mobile.
- `npm run typecheck` : type-check des 3 apps.

Configuration : copiez `apps/api/.env.example` en `apps/api/.env` (port, base, `EMAIL_PROVIDER`,
Shopify…) et, si besoin, `apps/web/.env.example` en `apps/web/.env` (`VITE_API_URL`).

### Connexion de démo (valeurs de test uniquement)

- Back-office : `demo@missive.local` / `demo1234`
- Clé API : `msv_dev_key_123`

Le seed crée le compte « Boutique Démo », ~60 contacts, 3 segments, 4 campagnes (dont 2 envoyées avec
ouvertures et clics sur 30 jours) et 2 automatisations. Avec `EMAIL_PROVIDER=log` (par défaut), aucun
email ne part réellement : tout est visible dans **Boîte d'envoi (dev)** du back-office.

## Connecter Shopify

Dans le back-office : **Intégrations → Shopify**, saisissez le domaine `ma-boutique.myshopify.com` et un jeton
Admin API (`shpat_…`) avec les scopes `read_customers` et `read_orders`. Missive valide le jeton, enregistre
les webhooks (clients, commandes, checkouts, désinstallation) et lance une première synchronisation.

- Sans boutique : les boutons « Simuler une commande » / « Simuler un panier abandonné »
  (`POST /api/v1/integrations/shopify/simulate`) déclenchent les automatisations correspondantes.
- Les webhooks Shopify n'atteignent qu'une URL HTTPS publique : en local, exposez l'API (tunnel) et
  renseignez `PUBLIC_URL`.
- Depuis 2026, Shopify ne permet plus de créer de nouvelles apps personnalisées dans l'admin : le module
  accepte aussi `{shop_domain, client_id, client_secret}` d'une app du Dev Dashboard.

Détails : [`apps/api/src/integrations/shopify/README.md`](./apps/api/src/integrations/shopify/README.md).

## App mobile

```bash
cd apps/mobile && npm start   # puis scannez le QR code avec Expo Go
```

Sur un téléphone physique, `localhost` désigne le téléphone : sur l'écran de connexion, indiquez l'adresse
IP de votre Mac sur le réseau local (`ipconfig getifaddr en0`, par ex. `http://192.168.1.20:4000`).
L'API écoute sur `0.0.0.0`, elle est donc joignable depuis le réseau local.
Détails : [`apps/mobile/README.md`](./apps/mobile/README.md).

## Feuille de route

1. **Envoi en production avec Amazon SES** : sortie du sandbox SES, identité de domaine vérifiée,
   configuration sets, traitement des notifications de bounce et de plainte (SNS → webhook → statut
   `bounced` / `complained`), file d'envoi persistante et reprise sur erreur.
2. **Authentification du domaine** : DKIM (Easy DKIM SES), SPF et MAIL FROM personnalisé, politique
   DMARC progressive (`p=none` → `quarantine` → `reject`), assistant DNS dans le back-office.
3. **Délivrabilité** : warm-up des nouveaux domaines, suppression automatique des bounces et plaintes,
   double opt-in, nettoyage des contacts inactifs, tests de spam et de rendu, suivi des taux par FAI,
   liens de tracking sur domaine personnalisé.
4. **Facturation au volume d'emails** : offres par paliers d'emails envoyés par mois (compteur
   `emails_sent_month` déjà exposé par `/me`), Stripe Billing avec facturation à l'usage, quotas et alertes.
5. **SMS et notifications push** : nouveaux canaux dans les campagnes et les automatisations
   (consentement dédié, fournisseur SMS, Expo Push pour l'app mobile).
6. **Migration vers Postgres** : remplacement de `node:sqlite` par Postgres (migrations versionnées),
   file de tâches dédiée pour le worker, scalabilité horizontale de l'API.
7. **Également** : app Shopify publique (OAuth),
   éditeur d'email visuel, tests A/B d'objet, rôles et équipes.
