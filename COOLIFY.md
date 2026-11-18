# Déployer Pingsell sur Coolify

Deux domaines publics, quatre conteneurs :

| Service | Dossier | Domaine | Rôle |
|---|---|---|---|
| `web` | `apps/web` | `https://app.pingsell.com` | L'app, et l'API sous le même domaine (`/api`, `/t`, `/u`, `/media`, `/health`) |
| `site` | `apps/site` | `https://pingsell.com` | Le site vitrine |
| `api` | `apps/api` | aucun (interne) | Fastify + SQLite, joint par `web` via `http://api:4000` |
| `mta` | `apps/mta` | port 25 de l'hôte | Notre serveur d'envoi d'emails (Postfix + DKIM) : voir [ENVOI-EMAIL.md](ENVOI-EMAIL.md) |

## Mise en place

1. Coolify → **New Resource** → dépôt `github.com/benjbin/pingsell`, branche `main`.
2. Build pack : **Docker Compose**, fichier `/docker-compose.yml`.
3. **Deploy**. Sans rien régler, Coolify génère un domaine pour `web` et un pour `site`.
4. Pour vos vrais domaines : onglet de chaque service → **Domains** (`web` → `https://app…`, `site` → `https://…`), puis **Redeploy**.

## Variables (toutes facultatives)

| Variable | Exemple | Rôle |
|---|---|---|
| `EMAIL_PROVIDER` | `smtp` | `smtp` (défaut) = notre serveur `mta` ; `log` = aucun email ne part ; `ses` = Amazon SES |
| `MAIL_DOMAIN` | `pingsell.neokrome.tech` | Domaine d'envoi (DNS : voir [ENVOI-EMAIL.md](ENVOI-EMAIL.md)) |
| `MAIL_FROM_EMAIL` | `bonjour@pingsell.neokrome.tech` | Expéditeur par défaut |
| `MAIL_WARMUP_START` | `2026-11-20` | Premier jour d'envoi : active le plafond quotidien progressif |
| `PUSH_MODE` | `live` | `live` = vrais envois FCM / APNs / Expo, `log` = test |
| `PUBLIC_URL` / `WEB_URL` | `https://app.pingsell.com` | Forcer l'adresse de l'app (sinon : domaine du service `web`) |
| `SITE_URL` | `https://pingsell.com` | Forcer l'adresse du site (sinon : domaine du service `site`) |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | — | Seulement pour l'app publique Shopify (OAuth) |

Les adresses sont intégrées au build de l'app et du site : après un changement de domaine, **Redeploy**.

## Bon à savoir

- Données : volume `pingsell-data` monté sur `/data` (base `pingsell.db` + images). À sauvegarder.
- Le schéma SQLite est créé et mis à jour par l'API au démarrage : aucune migration à lancer.
- SQLite = une seule instance de l'API, pas de réplicas.
- Vérification : `https://app…/health` répond `{"ok":true}`.
- Le compte démo n'existe qu'en local : en ligne, créez votre compte sur `/inscription`.
