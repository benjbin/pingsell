# @pingsell/expo-push

Notifications Pingsell pour une app React Native / Expo : écran verrouillé, centre de notifications dans l'app, bannière in-app et badge des non-lues.

```tsx
import { Pingsell, PingsellInbox, PingsellBadge, PingsellInAppBanner } from "@pingsell/expo-push";

Pingsell.init({ appKey: "msvapp_…", apiUrl: "https://api.votre-domaine.fr", foreground: "banner" });

// À chaque lancement, puis après la connexion du client
await Pingsell.register({ email: user.email, userHash: user.pingsellHash });
await Pingsell.logout(); // à la déconnexion

<PingsellInbox />                       // écran « Notifications »
<PingsellBadge><BellIcon /></PingsellBadge>
<PingsellInAppBanner />                 // une fois, à la racine
```

- Dépendances de l'app : `expo-notifications`, `expo-constants`.
- `tokenType: "expo"` (défaut) passe par Expo Push ; `"device"` envoie les jetons APNs / FCM natifs via vos clés Firebase / Apple enregistrées dans Pingsell.
- Android : le canal `pingsell` (importance haute, contenu visible sur l'écran verrouillé) est créé automatiquement.
- Vérification d'identité : `userHash = HMAC-SHA256(clé msvid_…, email en minuscules)`, calculé par **votre serveur**.
- Les notifications réelles nécessitent un vrai téléphone (ou un simulateur iOS avec `xcrun simctl push`) et un *development build* sur Android (Expo Go ne reçoit plus les push Android).

Démo complète : `examples/expo-shop`.

## Écran de pré-permission

iOS ne laisse demander les notifications qu'une seule fois. Rendez `<PingsellPermissionPrompt />` à la racine,
puis appelez `Pingsell.requestPermission()` au bon moment (après un premier achat, par exemple) :
votre message (réglé dans Pingsell, sans mise à jour de l'app) s'affiche d'abord, et la fenêtre système
n'apparaît que pour les clients qui ont touché « Activer ». Les affichages, acceptations et refus
remontent dans Pingsell (taux d'opt-in). Passez `storage: AsyncStorage` à `Pingsell.init` pour retenir
le nombre de lancements et le « Plus tard » d'une session à l'autre.

## Connexion du client

`Pingsell.identify({ email, userHash })` à la connexion relie le téléphone au contact et déclenche
les automatisations « Première connexion à l'app » (même si les notifications sont coupées).
L'activation des notifications sur un premier appareil déclenche « Notifications activées ».
