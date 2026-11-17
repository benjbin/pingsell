# @missive/expo-push

Notifications Missive pour une app React Native / Expo : écran verrouillé, centre de notifications dans l'app, bannière in-app et badge des non-lues.

```tsx
import { Missive, MissiveInbox, MissiveBadge, MissiveInAppBanner } from "@missive/expo-push";

Missive.init({ appKey: "msvapp_…", apiUrl: "https://api.votre-missive.fr", foreground: "banner" });

// À chaque lancement, puis après la connexion du client
await Missive.register({ email: user.email, userHash: user.missiveHash });
await Missive.logout(); // à la déconnexion

<MissiveInbox />                       // écran « Notifications »
<MissiveBadge><BellIcon /></MissiveBadge>
<MissiveInAppBanner />                 // une fois, à la racine
```

- Dépendances de l'app : `expo-notifications`, `expo-constants`.
- `tokenType: "expo"` (défaut) passe par Expo Push ; `"device"` envoie les jetons APNs / FCM natifs via vos clés Firebase / Apple enregistrées dans Missive.
- Android : le canal `missive` (importance haute, contenu visible sur l'écran verrouillé) est créé automatiquement.
- Vérification d'identité : `userHash = HMAC-SHA256(clé msvid_…, email en minuscules)`, calculé par **votre serveur**.
- Les notifications réelles nécessitent un vrai téléphone (ou un simulateur iOS avec `xcrun simctl push`) et un *development build* sur Android (Expo Go ne reçoit plus les push Android).

Démo complète : `examples/expo-shop`.
