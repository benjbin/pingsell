# Pingsell iOS

Notifications push Pingsell pour une app iOS native (Swift, iOS 14+).

## Installation

Xcode → **File → Add Package Dependencies…** → `https://github.com/benjbin/pingsell` → produit **Pingsell**.

## Code

```swift
import Pingsell

// application(_:didFinishLaunchingWithOptions:)
Pingsell.initialize(appKey: "msvapp_…")                       // tokenProvider: .fcm si l'app utilise Firebase
UNUserNotificationCenter.current().delegate = self

// application(_:didRegisterForRemoteNotificationsWithDeviceToken:)
Pingsell.setAPNsToken(deviceToken)                           // ou Pingsell.setFCMToken(fcmToken)

// Connexion / déconnexion du client
Pingsell.login(email: user.email)
Pingsell.logout()

// Au bon moment : la fenêtre du système (une seule fois possible sur iOS)
let granted = await Pingsell.requestPermission()

// UNUserNotificationCenterDelegate
func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                            withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done(Pingsell.presentationOptions(for: n))
}
func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse,
                            withCompletionHandler done: @escaping () -> Void) {
    if !Pingsell.handleNotificationOpened(r) { /* vos autres notifications */ }
    done()
}
```

- Lien à l'ouverture : ouvert automatiquement, ou `Pingsell.onOpen = { notification in … }` pour le gérer vous-même.
- Centre de notifications : `try await Pingsell.inbox()`, `unreadCount()`, `markRead(ids:)`, `open(item)`.
- Clé dans Pingsell : clé APNs (.p8) pour `.apns`, compte de service Firebase pour `.fcm`.
