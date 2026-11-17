# Déployer Pingsell sur Coolify

Trois services, trois domaines :

| Service | Dossier | Exemple de domaine | Port interne |
|---|---|---|---|
| API (Fastify + SQLite) | `apps/api` | `https://api.pingsell.com` | 4000 |
| App (back-office) | `apps/web` | `https://app.pingsell.com` | 80 |
| Site vitrine | `apps/site` | `https://pingsell.com` | 80 |

## Option A — une seule ressource « Docker Compose » (recommandée)

1. Coolify → **New Resource** → **Public/Private Repository** → `github.com/benjbin/pingsell`, branche `main`.
2. Build pack : **Docker Compose**, fichier `/docker-compose.yml`.
3. Dans l'onglet de chaque service, mettre son domaine (`api` → `https://api…:4000`, `web` → `https://app…`, `site` → `https://…`).
4. Renseigner les variables ci-dessous (onglet **Environment Variables**), puis **Deploy**.

## Option B — trois ressources « Dockerfile »

Pour chacune : même dépôt, build pack **Dockerfile**, **Base Directory** = `/apps/api`, `/apps/web` ou `/apps/site`, port exposé 4000 / 80 / 80.
Pour l'API, ajouter un **volume persistant** monté sur `/data` (base SQLite + images importées).

## Variables

### API (`apps/api`) — variables d'exécution

| Variable | Obligatoire | Exemple | Rôle |
|---|---|---|---|
| `PUBLIC_URL` | oui | `https://api.pingsell.com` | URL publique de l'API (liens de suivi, pixels d'ouverture) |
| `WEB_URL` | oui | `https://app.pingsell.com` | Origine autorisée (CORS), plusieurs séparées par des virgules |
| `DATABASE_PATH` | non | `/data/pingsell.db` | Fichier SQLite, **doit être dans le volume `/data`** |
| `UPLOAD_DIR` | non | `/data/uploads` | Images de la médiathèque, dans le volume |
| `EMAIL_PROVIDER` | oui en prod | `ses` | `log` = rien n'est envoyé ; `ses` = Amazon SES |
| `AWS_REGION` | si SES | `eu-west-3` | Région SES |
| `AWS_ACCESS_KEY_ID` | si SES | — | Clé IAM SES (secret) |
| `AWS_SECRET_ACCESS_KEY` | si SES | — | Secret IAM SES (secret) |
| `MAIL_FROM_EMAIL` | conseillé | `bonjour@pingsell.com` | Expéditeur par défaut, vérifié dans SES |
| `PUSH_MODE` | non | `live` | `live` = vrais envois FCM / APNs / Expo, `log` = test |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | non | — | Seulement pour l'app publique Shopify (OAuth) |
| `LOG_LEVEL` | non | `info` | Niveau de logs |

Le schéma SQLite est créé et mis à jour par l'API au démarrage : aucune migration à lancer.
L'entrypoint donne le volume `/data` à l'utilisateur `node` puis démarre l'API sans les droits root.

### App (`apps/web`) — variables de **build** (cocher « Build Variable » dans Coolify)

| Variable | Exemple | Rôle |
|---|---|---|
| `VITE_API_URL` | `https://api.pingsell.com` | Origine de l'API, **sans** `/api/v1` |
| `VITE_SITE_URL` | `https://pingsell.com` | Lien « Retour au site » de la page de connexion |

### Site (`apps/site`) — variables de **build**

| Variable | Exemple | Rôle |
|---|---|---|
| `VITE_APP_URL` | `https://app.pingsell.com` | Cible de « Se connecter » et « Essai gratuit » |
| `VITE_API_URL` | `https://api.pingsell.com/api/v1` | Exemples de code de la section API, **avec** `/api/v1` |

Avec l'option A, il suffit de définir `PUBLIC_URL`, `WEB_URL` et `SITE_URL` : le compose en déduit les variables de build.

## Après le premier déploiement

- `https://api…/health` doit répondre `{"ok":true}`.
- Créer un compte depuis `https://app…/inscription` (le compte démo n'existe qu'en local, via `npm run seed`).
- Sauvegarder le volume `/data` (Coolify → **Backups** ou copie planifiée de `pingsell.db`).
- SQLite = une seule instance de l'API : ne pas monter plusieurs réplicas.
