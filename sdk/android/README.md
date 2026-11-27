# Pingsell Android

Notifications push Pingsell pour une app Android native (Kotlin ou Java, Android 5+), par Firebase Cloud Messaging.

## Installation

```kotlin
// settings.gradle.kts → dependencyResolutionManagement.repositories
maven("https://jitpack.io")

// app/build.gradle.kts (l'app doit déjà utiliser Firebase : google-services.json)
implementation("com.github.benjbin:pingsell:<version>")
```

## Code

```kotlin
// Application.onCreate
Pingsell.initialize(this, appKey = "msvapp_…")

// Connexion / déconnexion du client
Pingsell.login(email = user.email)
Pingsell.logout()

// Au bon moment (Android 13+ : fenêtre d'autorisation du système)
Pingsell.requestPermission(activity) { granted -> }

// Votre FirebaseMessagingService
override fun onNewToken(token: String) { Pingsell.setFCMToken(token) }
override fun onMessageReceived(message: RemoteMessage) {
    if (Pingsell.handleMessage(this, message)) return
    // vos autres notifications
}

// Activité ouverte par le tap : onCreate et onNewIntent
Pingsell.handleOpen(intent)
```

- Pas encore de service Firebase ? Déclarez `tech.pingsell.sdk.PingsellMessagingService` dans le manifeste.
- Lien à l'ouverture : ouvert automatiquement, ou `Pingsell.onOpen = { notification -> }`.
- Centre de notifications : `Pingsell.inbox { result -> }`, `unreadCount`, `markRead`, `open(item)`.
- Clé dans Pingsell : le compte de service Firebase du projet de l'app.
