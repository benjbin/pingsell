import Foundation
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

/// Notifications push Pingsell pour une app iOS native.
///
/// ```swift
/// // AppDelegate.didFinishLaunching
/// Pingsell.initialize(appKey: "msvapp_…")
/// UNUserNotificationCenter.current().delegate = self
///
/// // AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken
/// Pingsell.setAPNsToken(deviceToken)            // ou Pingsell.setFCMToken(fcmToken) si l'app utilise Firebase
///
/// // Connexion / déconnexion du client
/// Pingsell.login(email: user.email)
/// Pingsell.logout()
///
/// // Au bon moment (après une première réservation, par exemple)
/// let granted = await Pingsell.requestPermission()
///
/// // UNUserNotificationCenterDelegate.didReceive
/// if Pingsell.handleNotificationOpened(response) { completionHandler(); return }
/// ```
public enum Pingsell {
    /// Version du SDK, envoyée à Pingsell avec chaque appareil.
    public static let sdkVersion = "1.0.0"

    /// Quel jeton Pingsell reçoit : le jeton APNs d'Apple (défaut, clé .p8 dans Pingsell) ou le jeton Firebase
    /// (si l'app utilise déjà Firebase Messaging : seule la clé Firebase est alors nécessaire dans Pingsell).
    public enum TokenProvider: String {
        case apns
        case fcm
    }

    /// Une notification Pingsell touchée par le client, ou un élément du centre de notifications.
    public struct Notification: Equatable {
        public let messageId: String?
        public let inboxId: String?
        public let title: String
        public let body: String
        public let url: URL?
        public let imageURL: URL?
        /// Toutes les données reçues (clés personnalisées comprises).
        public let data: [String: String]
    }

    /// Un élément du centre de notifications de l'app.
    public struct InboxItem: Decodable, Equatable, Identifiable {
        public let id: String
        public let title: String
        public let body: String
        public let image_url: String?
        public let url: String?
        public let created_at: String
        public let read: Bool
    }

    public struct Inbox: Decodable, Equatable {
        public let data: [InboxItem]
        public let unread: Int
    }

    public enum PingsellError: LocalizedError {
        case notInitialized
        case noDeviceToken
        case http(status: Int, message: String)

        public var errorDescription: String? {
            switch self {
            case .notInitialized: return "Pingsell : appelez Pingsell.initialize(appKey:) d'abord"
            case .noDeviceToken: return "Pingsell : ce téléphone n'a pas encore de jeton de notification"
            case let .http(status, message): return "Pingsell (\(status)) : \(message)"
            }
        }
    }

    // MARK: - Configuration

    /// Appelé quand le client touche une notification Pingsell. Par défaut, son lien est ouvert.
    public static var onOpen: ((Notification) -> Void)?

    /// Journal (désactivé par défaut) : `Pingsell.logger = { print($0) }`.
    public static var logger: ((String) -> Void)?

    /// - Parameters:
    ///   - appKey: la clé publique de l'app (`msvapp_…`), dans Pingsell → Notifications push → Configuration.
    ///   - apiURL: l'adresse de Pingsell.
    ///   - tokenProvider: `.apns` (défaut) ou `.fcm` si vous passez le jeton Firebase.
    public static func initialize(
        appKey: String,
        apiURL: URL = URL(string: "https://app.pingsell.neokrome.tech")!,
        tokenProvider: TokenProvider = .apns
    ) {
        state.sync {
            state.config = Config(appKey: appKey.trimmingCharacters(in: .whitespacesAndNewlines), apiURL: apiURL, provider: tokenProvider)
        }
        // Notifications coupées dans les réglages depuis la dernière fois : Pingsell arrête d'y envoyer.
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            if settings.authorizationStatus == .denied, Store.registeredToken != nil {
                unregisterDevice()
            } else if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
                #if canImport(UIKit)
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
                #endif
                // Déjà un jeton : rafraîchi auprès de Pingsell (version de l'app, dernier passage).
                registerIfPossible(force: true)
            }
        }
    }

    // MARK: - Jetons

    /// À appeler dans `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    public static func setAPNsToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Store.apnsToken = hex
        if currentProvider == .apns { registerIfPossible() }
    }

    /// Jeton Firebase (`Messaging.messaging().token`) quand `tokenProvider: .fcm`.
    public static func setFCMToken(_ token: String) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Store.fcmToken = trimmed
        if currentProvider == .fcm { registerIfPossible() }
    }

    /// Le jeton que Pingsell utilise pour ce téléphone (nil tant que les notifications ne sont pas activées).
    public static var deviceToken: String? {
        currentProvider == .fcm ? Store.fcmToken : Store.apnsToken
    }

    // MARK: - Client

    /// Le client s'est connecté : relie ce téléphone à son contact Pingsell (segments, tags, automatisations),
    /// même si les notifications sont coupées (automatisation « Première connexion à l'app »).
    /// - Parameter userHash: HMAC-SHA256(clé `msvid_…`, email en minuscules), calculé par votre serveur,
    ///   seulement si la vérification d'identité est activée dans Pingsell.
    public static func login(email: String, userHash: String? = nil) {
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !email.isEmpty else { return }
        let changed = Store.email != email || Store.userHash != userHash
        Store.email = email
        Store.userHash = userHash
        var body: [String: Any] = ["email": email]
        if let userHash { body["user_hash"] = userHash }
        if let token = deviceToken { body["token"] = token }
        request("POST", "/push/app/identify", body: body) { _ in }
        if changed { registerIfPossible(force: true) }
    }

    /// Le client s'est déconnecté : le téléphone reste abonné, mais n'est plus relié à son contact.
    public static func logout() {
        Store.email = nil
        Store.userHash = nil
        guard let token = deviceToken else { return }
        request("POST", "/push/app/devices/logout", body: ["token": token]) { _ in }
    }

    // MARK: - Permission

    /// Affiche la demande d'autorisation du système (une seule fois possible sur iOS), puis abonne le téléphone.
    @discardableResult
    public static func requestPermission(options: UNAuthorizationOptions = [.alert, .badge, .sound]) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let before = await center.notificationSettings().authorizationStatus
        let granted = (try? await center.requestAuthorization(options: options)) ?? false
        if before == .notDetermined {
            request("POST", "/push/app/prompt", body: ["event": granted ? "granted" : "denied", "platform": "ios"]) { _ in }
        }
        if granted {
            #if canImport(UIKit)
            await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
            #endif
        }
        return granted
    }

    // MARK: - Notifications reçues

    /// Vrai pour une notification envoyée par Pingsell.
    public static func isPingsellNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
        userInfo["pingsell_message_id"] != nil || userInfo["pingsell_inbox_id"] != nil
    }

    /// À appeler dans `userNotificationCenter(_:didReceive:withCompletionHandler:)`. Compte l'ouverture dans
    /// Pingsell et ouvre le lien de la notification (ou appelle `Pingsell.onOpen`). Faux si elle n'est pas de Pingsell.
    @discardableResult
    public static func handleNotificationOpened(_ response: UNNotificationResponse) -> Bool {
        let content = response.notification.request.content
        guard isPingsellNotification(content.userInfo) else { return false }
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return true }
        let notification = makeNotification(title: content.title, body: content.body, userInfo: content.userInfo)
        if let id = notification.messageId {
            request("POST", "/push/app/opened", body: ["message_id": id]) { _ in }
        }
        open(notification)
        return true
    }

    /// Options d'affichage d'une notification Pingsell reçue app ouverte (bannière, son, badge).
    public static func presentationOptions(for notification: UNNotification) -> UNNotificationPresentationOptions {
        if #available(iOS 14.0, *) { return [.banner, .list, .sound, .badge] }
        return [.alert, .sound, .badge]
    }

    // MARK: - Centre de notifications

    /// Les notifications du centre de notifications de ce téléphone (les plus récentes d'abord).
    public static func inbox(limit: Int = 50) async throws -> Inbox {
        try await call("GET", "/push/app/inbox?limit=\(max(1, min(limit, 100)))", body: nil)
    }

    public static func unreadCount() async throws -> Int {
        struct R: Decodable { let unread: Int }
        let r: R = try await call("GET", "/push/app/inbox/unread", body: nil)
        return r.unread
    }

    /// Marque comme lues (toutes si `ids` est nil) ; renvoie le nombre de non-lues restantes.
    @discardableResult
    public static func markRead(ids: [String]? = nil) async throws -> Int {
        struct R: Decodable { let unread: Int }
        let r: R = try await call("POST", "/push/app/inbox/read", body: ids.map { ["ids": $0] } ?? [:])
        return r.unread
    }

    @discardableResult
    public static func deleteInboxItems(ids: [String]) async throws -> Int {
        struct R: Decodable { let unread: Int }
        let r: R = try await call("POST", "/push/app/inbox/delete", body: ["ids": ids])
        return r.unread
    }

    /// Ouvre un élément du centre de notifications : le marque lu, puis comme un tap sur la notification.
    public static func open(_ item: InboxItem) {
        Task { _ = try? await markRead(ids: [item.id]) }
        open(Notification(
            messageId: nil,
            inboxId: item.id,
            title: item.title,
            body: item.body,
            url: item.url.flatMap(URL.init(string:)),
            imageURL: item.image_url.flatMap(URL.init(string:)),
            data: [:]
        ))
    }

    // MARK: - Interne

    struct Config {
        let appKey: String
        let apiURL: URL
        let provider: TokenProvider
    }

    final class State {
        private let lock = NSLock()
        var config: Config?
        var registering = false
        func sync<T>(_ body: () -> T) -> T {
            lock.lock()
            defer { lock.unlock() }
            return body()
        }
    }

    static let state = State()

    static var currentProvider: TokenProvider { state.sync { state.config?.provider ?? .apns } }

    /// Ce qui survit aux redémarrages (UserDefaults, préfixe pingsell.).
    enum Store {
        private static let defaults = UserDefaults.standard
        static var apnsToken: String? {
            get { defaults.string(forKey: "pingsell.apnsToken") }
            set { defaults.set(newValue, forKey: "pingsell.apnsToken") }
        }
        static var fcmToken: String? {
            get { defaults.string(forKey: "pingsell.fcmToken") }
            set { defaults.set(newValue, forKey: "pingsell.fcmToken") }
        }
        static var email: String? {
            get { defaults.string(forKey: "pingsell.email") }
            set { defaults.set(newValue, forKey: "pingsell.email") }
        }
        static var userHash: String? {
            get { defaults.string(forKey: "pingsell.userHash") }
            set { defaults.set(newValue, forKey: "pingsell.userHash") }
        }
        /// « jeton|email » déjà enregistré chez Pingsell (évite un appel à chaque jeton identique).
        static var registeredToken: String? {
            get { defaults.string(forKey: "pingsell.registered") }
            set { defaults.set(newValue, forKey: "pingsell.registered") }
        }
    }

    static var appVersion: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    static func registerIfPossible(force: Bool = false) {
        guard let token = deviceToken else { return }
        let signature = "\(token)|\(Store.email ?? "")"
        if !force && Store.registeredToken == signature { return }
        let provider = currentProvider
        var body: [String: Any] = ["token": token, "platform": "ios", "provider": provider.rawValue]
        if let email = Store.email { body["email"] = email }
        if let hash = Store.userHash { body["user_hash"] = hash }
        if let version = appVersion { body["app_version"] = version }
        request("POST", "/push/app/devices", body: body) { ok in
            if ok { Store.registeredToken = signature }
        }
    }

    static func unregisterDevice() {
        guard let token = deviceToken else { return }
        request("POST", "/push/app/devices/unregister", body: ["token": token]) { ok in
            if ok { Store.registeredToken = nil }
        }
    }

    static func makeNotification(title: String, body: String, userInfo: [AnyHashable: Any]) -> Notification {
        var data: [String: String] = [:]
        for (key, value) in userInfo {
            guard let key = key as? String, key != "aps" else { continue }
            if let s = value as? String { data[key] = s } else if let n = value as? NSNumber { data[key] = n.stringValue }
        }
        return Notification(
            messageId: data["pingsell_message_id"],
            inboxId: data["pingsell_inbox_id"],
            title: title,
            body: body,
            url: data["url"].flatMap(URL.init(string:)),
            imageURL: data["image_url"].flatMap(URL.init(string:)),
            data: data
        )
    }

    static func open(_ notification: Notification) {
        if let onOpen {
            DispatchQueue.main.async { onOpen(notification) }
            return
        }
        #if canImport(UIKit)
        guard let url = notification.url else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
        #endif
    }

    /// Appel sans attente du résultat (enregistrement, ouverture…) : réessaie une fois en cas de coupure réseau.
    static func request(_ method: String, _ path: String, body: [String: Any]?, retry: Bool = true, done: @escaping (Bool) -> Void) {
        Task {
            do {
                let _: Empty = try await call(method, path, body: body)
                done(true)
            } catch let error as URLError where retry {
                logger?("Pingsell \(path) : \(error.localizedDescription), nouvel essai dans 10 s")
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                request(method, path, body: body, retry: false, done: done)
            } catch {
                logger?("Pingsell \(path) : \(error.localizedDescription)")
                done(false)
            }
        }
    }

    struct Empty: Decodable {}

    static func call<T: Decodable>(_ method: String, _ path: String, body: [String: Any]?) async throws -> T {
        guard let config = state.sync({ state.config }) else { throw PingsellError.notInitialized }
        guard let url = URL(string: "/api/v1" + path, relativeTo: config.apiURL) else { throw PingsellError.notInitialized }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = method
        req.setValue("Bearer \(config.appKey)", forHTTPHeaderField: "Authorization")
        req.setValue(Locale.preferredLanguages.first ?? "fr", forHTTPHeaderField: "Accept-Language")
        req.setValue("pingsell-ios/\(sdkVersion)", forHTTPHeaderField: "X-Pingsell-SDK")
        if let token = deviceToken { req.setValue(token, forHTTPHeaderField: "X-Pingsell-Device") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = (json?["message"] as? String) ?? (json?["error"] as? String) ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw PingsellError.http(status: status, message: message)
        }
        if T.self == Empty.self { return Empty() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
