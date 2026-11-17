# Missive — app mobile

Application Expo (SDK 58, expo-router, TypeScript) pour suivre l'activité Missive depuis un téléphone :
KPI, campagnes (stats, envoi de test, envoi immédiat) et contacts. Interface en français, thème clair/sombre
automatique, accent violet `#6D28D9`.

## Prérequis

- Node 25 et npm
- L'API Missive démarrée (`apps/api` : `npm install && npm run seed && npm run dev`, port 4000)
- Sur iPhone : l'app **Expo Go** (App Store), compatible SDK 58

## Lancer

```bash
cd apps/mobile
npm install
npm start          # expo start : affiche un QR code
```

- **iPhone (Expo Go)** : ouvrez l'appareil photo, scannez le QR code, l'app s'ouvre dans Expo Go.
  Le Mac et l'iPhone doivent être sur le même réseau Wi-Fi (sinon `npx expo start --tunnel`).
- **Simulateur iOS** : `npm run ios` (Xcode requis).
- **Navigateur** : `npm run web`.

### Adresse de l'API sur un téléphone physique

Sur l'écran de connexion, le champ « Adresse de l'API » vaut par défaut `http://localhost:4000`.
Cela fonctionne dans le simulateur et sur le web, **mais pas sur un iPhone physique** : `localhost` y désigne
le téléphone lui-même. Saisissez l'IP locale du Mac, par exemple `http://192.168.1.20:4000`.

Pour trouver l'IP du Mac : `ipconfig getifaddr en0`. Elle s'affiche aussi dans la sortie de `expo start`
(`exp://192.168.x.x:8081`), où il suffit de remplacer le port par `4000`.

L'API doit écouter sur toutes les interfaces (`0.0.0.0`), pas seulement sur `127.0.0.1`.

Compte de démo (après `npm run seed` côté API) : `demo@missive.local` (mot de passe dans `SPEC.md`).

## Écrans

| Onglet | Contenu |
|---|---|
| Connexion | URL de l'API + email/mot de passe. Le jeton de session est stocké avec `expo-secure-store` (localStorage sur web). |
| Accueil | Cartes KPI (`GET /stats/overview?days=7/30/90`), graphique en barres envoyés/ouverts (Views simples), utilisation du mois, tirer pour rafraîchir. |
| Campagnes | Liste filtrable par statut avec stats ; détail : stats complètes, taux, engagement par heure, envoi de test à l'email du compte, « Envoyer maintenant » avec confirmation indiquant le nombre de destinataires. Pendant l'envoi, la fiche se met à jour toute seule toutes les 3 s. |
| Contacts | Recherche (debounce), filtre par statut, pagination infinie ; détail : tags, attributs, commandes, événements récents, emails reçus. |
| Réglages | Compte, utilisation (emails ce mois, contacts), serveur API, déconnexion. |

Toute réponse 401 de l'API déconnecte l'utilisateur et renvoie à l'écran de connexion.

## Structure

```
src/app/                 routes expo-router
  _layout.tsx            AuthProvider + Stack protégée (login / onglets)
  login.tsx
  (tabs)/_layout.tsx     onglets
  (tabs)/index.tsx       Accueil
  (tabs)/campaigns/      liste + [id]
  (tabs)/contacts/       liste + [id]
  (tabs)/settings.tsx
src/lib/api.ts           client REST typé (contrat SPEC.md, /api/v1)
src/lib/types.ts         types du modèle de données
src/lib/auth.tsx         session (token, URL de l'API)
src/lib/useApi.ts        hook de chargement / rafraîchissement
src/components/          UI (cartes, badges, boutons) et BarChart
```

## Vérifications

```bash
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint (eslint-config-expo)
npx expo export --platform web    # build web
npx expo-doctor
```
