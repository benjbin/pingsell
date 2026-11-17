# Démo « Atelier Nord » — SDK Missive

1. `cp .env.example .env` et collez la clé `msvapp_…` (Missive › Notifications push › Configuration).
2. `npm install` puis `npm run ios` (simulateur) ou `npx expo start` + Expo Go sur un iPhone.
3. Onglet **Compte** › *Activer les notifications* (sur simulateur : *Jeton de test*).
4. Envoyez une notification depuis Missive : elle arrive sur l'écran verrouillé et dans l'onglet **Notifications**.

Sur simulateur, l'écran verrouillé se teste avec `xcrun simctl push booted host.exp.Exponent payload.apns`
(le `scopeKey` d'Expo Go doit correspondre à celui du projet).
