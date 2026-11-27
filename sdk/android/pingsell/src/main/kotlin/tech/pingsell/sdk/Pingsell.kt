package tech.pingsell.sdk

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Notifications push Pingsell pour une app Android native (Firebase Cloud Messaging).
 *
 * ```kotlin
 * // Application.onCreate
 * Pingsell.initialize(this, appKey = "msvapp_…")
 *
 * // Connexion / déconnexion du client
 * Pingsell.login(email = user.email)
 * Pingsell.logout()
 *
 * // Au bon moment (Android 13+ : fenêtre d'autorisation du système)
 * Pingsell.requestPermission(activity) { granted -> … }
 *
 * // Votre FirebaseMessagingService (ou PingsellMessagingService si vous n'en avez pas)
 * override fun onNewToken(token: String) { Pingsell.setFCMToken(token) }
 * override fun onMessageReceived(message: RemoteMessage) { if (Pingsell.handleMessage(this, message)) return; … }
 *
 * // Activité ouverte par le tap (onCreate et onNewIntent)
 * Pingsell.handleOpen(intent)
 * ```
 */
object Pingsell {
    const val SDK_VERSION = BuildConfig.SDK_VERSION

    /** Canal Android des notifications Pingsell (importance haute, contenu visible sur l'écran verrouillé). */
    const val CHANNEL_ID = "pingsell"

    /** Une notification Pingsell touchée par le client, ou un élément du centre de notifications. */
    data class Notification(
        val messageId: String?,
        val inboxId: String?,
        val title: String,
        val body: String,
        val url: String?,
        val imageUrl: String?,
        /** Toutes les données reçues (clés personnalisées comprises). */
        val data: Map<String, String>,
    )

    data class InboxItem(
        val id: String,
        val title: String,
        val body: String,
        val imageUrl: String?,
        val url: String?,
        val createdAt: String,
        val read: Boolean,
    )

    data class Inbox(val items: List<InboxItem>, val unread: Int)

    class PingsellException(val status: Int, message: String) : Exception(message)

    /** Appelé (sur le fil principal) quand le client touche une notification Pingsell. Par défaut, son lien est ouvert. */
    @JvmStatic var onOpen: ((Notification) -> Unit)? = null

    /** Journal : `Pingsell.debug = true` écrit dans Logcat (tag « Pingsell »). */
    @JvmStatic var debug = false

    /** Nom du canal affiché dans les réglages Android. */
    @JvmStatic var channelName = "Notifications"

    /** Petite icône des notifications affichées par Pingsell (app au premier plan) ; par défaut, celle de l'app. */
    @JvmStatic var smallIcon: Int = 0

    private const val TAG = "Pingsell"
    private const val PREFS = "pingsell"
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "pingsell").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val requestCodes = AtomicInteger(0x5150)

    private lateinit var app: Context
    private var appKey: String = ""
    private var apiUrl: String = ""

    private val prefs: SharedPreferences get() = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * @param appKey la clé publique de l'app (`msvapp_…`), dans Pingsell → Notifications push → Configuration.
     * @param apiUrl l'adresse de Pingsell.
     */
    @JvmStatic
    @JvmOverloads
    fun initialize(context: Context, appKey: String, apiUrl: String = "https://app.pingsell.neokrome.tech") {
        app = context.applicationContext
        this.appKey = appKey.trim()
        this.apiUrl = apiUrl.trimEnd('/')
        createChannel()
        if (!notificationsEnabled()) {
            // Notifications coupées dans les réglages depuis la dernière fois : Pingsell arrête d'y envoyer.
            if (prefs.getString("registered", null) != null) unregisterDevice()
            return
        }
        // Le jeton FCM de ce téléphone (Firebase doit être initialisé par l'app : google-services.json).
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> setFCMToken(token, force = true) }
        } catch (e: Exception) {
            log("Firebase indisponible : ${e.message}")
        }
    }

    /** Jeton FCM : à appeler dans `FirebaseMessagingService.onNewToken`. */
    @JvmStatic
    fun setFCMToken(token: String) = setFCMToken(token, force = false)

    private fun setFCMToken(token: String, force: Boolean) {
        val trimmed = token.trim()
        if (trimmed.isEmpty() || !ready()) return
        prefs.edit().putString("token", trimmed).apply()
        registerIfPossible(force)
    }

    /** Le jeton que Pingsell utilise pour ce téléphone (null tant que Firebase ne l'a pas donné). */
    @JvmStatic
    val deviceToken: String? get() = if (ready()) prefs.getString("token", null) else null

    /**
     * Le client s'est connecté : relie ce téléphone à son contact Pingsell (segments, tags, automatisations),
     * même si les notifications sont coupées (automatisation « Première connexion à l'app »).
     * @param userHash HMAC-SHA256(clé `msvid_…`, email en minuscules), calculé par votre serveur, seulement si
     * la vérification d'identité est activée dans Pingsell.
     */
    @JvmStatic
    @JvmOverloads
    fun login(email: String, userHash: String? = null) {
        if (!ready()) return
        val normalized = email.trim().lowercase(Locale.ROOT)
        if (normalized.isEmpty()) return
        val changed = prefs.getString("email", null) != normalized || prefs.getString("userHash", null) != userHash
        prefs.edit().putString("email", normalized).putString("userHash", userHash).apply()
        val body = JSONObject().put("email", normalized)
        userHash?.let { body.put("user_hash", it) }
        deviceToken?.let { body.put("token", it) }
        post("/push/app/identify", body)
        if (changed) registerIfPossible(force = true)
    }

    /** Le client s'est déconnecté : le téléphone reste abonné, mais n'est plus relié à son contact. */
    @JvmStatic
    fun logout() {
        if (!ready()) return
        prefs.edit().remove("email").remove("userHash").apply()
        val token = deviceToken ?: return
        post("/push/app/devices/logout", JSONObject().put("token", token))
    }

    /** Les notifications sont-elles autorisées sur ce téléphone ? */
    @JvmStatic
    fun notificationsEnabled(): Boolean = ready() && NotificationManagerCompat.from(app).areNotificationsEnabled()

    /**
     * Demande l'autorisation d'afficher des notifications (fenêtre du système, Android 13 et plus), puis abonne
     * le téléphone. Avant Android 13, l'autorisation est donnée à l'installation : `granted` vaut l'état actuel.
     */
    @JvmStatic
    fun requestPermission(activity: ComponentActivity, callback: ((Boolean) -> Unit)? = null) {
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            val granted = notificationsEnabled()
            if (granted) refreshToken()
            callback?.invoke(granted)
            return
        }
        val key = "pingsell-permission-${requestCodes.incrementAndGet()}"
        var launcher: androidx.activity.result.ActivityResultLauncher<String>? = null
        launcher = activity.activityResultRegistry.register(key, ActivityResultContracts.RequestPermission()) { granted ->
            launcher?.unregister()
            post("/push/app/prompt", JSONObject().put("event", if (granted) "granted" else "denied").put("platform", "android"))
            if (granted) refreshToken()
            callback?.invoke(granted)
        }
        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** Vrai pour un message envoyé par Pingsell. */
    @JvmStatic
    fun isPingsellMessage(data: Map<String, String>): Boolean =
        data.containsKey("pingsell_message_id") || data.containsKey("pingsell_inbox_id")

    /**
     * À appeler dans `onMessageReceived`. App au premier plan, Android n'affiche pas la notification lui-même :
     * Pingsell l'affiche (même canal, même tap). Faux si le message n'est pas de Pingsell.
     */
    @JvmStatic
    fun handleMessage(context: Context, message: RemoteMessage): Boolean {
        if (!isPingsellMessage(message.data)) return false
        val title = message.notification?.title ?: message.data["title"].orEmpty()
        val body = message.notification?.body ?: message.data["body"].orEmpty()
        show(context.applicationContext, title, body, message.data)
        return true
    }

    /**
     * À appeler dans l'activité ouverte par le tap (`onCreate` et `onNewIntent`) : compte l'ouverture dans Pingsell
     * et ouvre le lien de la notification (ou appelle `Pingsell.onOpen`). Faux si l'intent ne vient pas de Pingsell.
     */
    @JvmStatic
    fun handleOpen(intent: Intent?): Boolean {
        val extras = intent?.extras ?: return false
        val data = bundleToMap(extras)
        if (!isPingsellMessage(data)) return false
        // Une même ouverture n'est comptée qu'une fois (rotation d'écran, retour sur l'activité).
        if (extras.getBoolean(HANDLED, false)) return true
        intent.putExtra(HANDLED, true)
        val notification = toNotification(extras.getString("pingsell_title").orEmpty(), extras.getString("pingsell_body").orEmpty(), data)
        notification.messageId?.let { post("/push/app/opened", JSONObject().put("message_id", it)) }
        open(notification)
        return true
    }

    /* ----------------------------- Centre de notifications ----------------------------- */

    /** Les notifications du centre de notifications de ce téléphone (les plus récentes d'abord). */
    @JvmStatic
    @JvmOverloads
    fun inbox(limit: Int = 50, callback: (Result<Inbox>) -> Unit) = async(callback) {
        val json = call("GET", "/push/app/inbox?limit=${limit.coerceIn(1, 100)}", null)
        val rows = json.optJSONArray("data") ?: JSONArray()
        Inbox(
            items = (0 until rows.length()).map { i ->
                val r = rows.getJSONObject(i)
                InboxItem(
                    id = r.getString("id"),
                    title = r.optString("title"),
                    body = r.optString("body"),
                    imageUrl = r.optStringOrNull("image_url"),
                    url = r.optStringOrNull("url"),
                    createdAt = r.optString("created_at"),
                    read = r.optBoolean("read"),
                )
            },
            unread = json.optInt("unread"),
        )
    }

    @JvmStatic
    fun unreadCount(callback: (Result<Int>) -> Unit) = async(callback) { call("GET", "/push/app/inbox/unread", null).optInt("unread") }

    /** Marque comme lues (toutes si `ids` est null) ; renvoie le nombre de non-lues restantes. */
    @JvmStatic
    @JvmOverloads
    fun markRead(ids: List<String>? = null, callback: ((Result<Int>) -> Unit)? = null) = async(callback ?: {}) {
        val body = JSONObject()
        ids?.let { body.put("ids", JSONArray(it)) }
        call("POST", "/push/app/inbox/read", body).optInt("unread")
    }

    @JvmStatic
    @JvmOverloads
    fun deleteInboxItems(ids: List<String>, callback: ((Result<Int>) -> Unit)? = null) = async(callback ?: {}) {
        call("POST", "/push/app/inbox/delete", JSONObject().put("ids", JSONArray(ids))).optInt("unread")
    }

    /** Ouvre un élément du centre de notifications : le marque lu, puis comme un tap sur la notification. */
    @JvmStatic
    fun open(item: InboxItem) {
        markRead(listOf(item.id))
        open(Notification(null, item.id, item.title, item.body, item.url, item.imageUrl, emptyMap()))
    }

    /* ----------------------------------- Interne ----------------------------------- */

    private const val HANDLED = "pingsell_handled"

    private fun ready(): Boolean = this::app.isInitialized && appKey.isNotEmpty()

    private fun log(message: String) {
        if (debug) Log.d(TAG, message)
    }

    private fun refreshToken() {
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> setFCMToken(token, force = true) }
        } catch (e: Exception) {
            log("Firebase indisponible : ${e.message}")
        }
    }

    private fun registerIfPossible(force: Boolean) {
        val token = deviceToken ?: return
        if (!notificationsEnabled()) return
        val email = prefs.getString("email", null)
        val signature = "$token|${email.orEmpty()}"
        if (!force && prefs.getString("registered", null) == signature) return
        val body = JSONObject()
            .put("token", token)
            .put("platform", "android")
            .put("provider", "fcm")
        email?.let { body.put("email", it) }
        prefs.getString("userHash", null)?.let { body.put("user_hash", it) }
        appVersion()?.let { body.put("app_version", it) }
        post("/push/app/devices", body) { ok -> if (ok) prefs.edit().putString("registered", signature).apply() }
    }

    private fun unregisterDevice() {
        val token = deviceToken ?: return
        post("/push/app/devices/unregister", JSONObject().put("token", token)) { ok ->
            if (ok) prefs.edit().remove("registered").apply()
        }
    }

    private fun appVersion(): String? = try {
        app.packageManager.getPackageInfo(app.packageName, 0).versionName
    } catch (e: Exception) {
        null
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = app.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_HIGH).apply {
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun show(context: Context, title: String, body: String, data: Map<String, String>) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        if (!this::app.isInitialized) app = context
        createChannel()
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        data.forEach { (k, v) -> launch.putExtra(k, v) }
        launch.putExtra("pingsell_title", title)
        launch.putExtra("pingsell_body", body)
        val id = (data["pingsell_message_id"] ?: data["pingsell_inbox_id"] ?: title).hashCode()
        val pending = PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val icon = if (smallIcon != 0) smallIcon else context.applicationInfo.icon
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pending)
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build())
        } catch (e: SecurityException) {
            log("Notification non affichée : ${e.message}")
        }
    }

    private fun open(notification: Notification) {
        main.post {
            val handler = onOpen
            if (handler != null) {
                handler(notification)
                return@post
            }
            val url = notification.url ?: return@post
            try {
                val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                app.startActivity(view)
            } catch (e: Exception) {
                log("Lien non ouvert ($url) : ${e.message}")
            }
        }
    }

    internal fun bundleToMap(extras: Bundle): Map<String, String> {
        val out = HashMap<String, String>()
        for (key in extras.keySet()) {
            @Suppress("DEPRECATION")
            val value = extras.get(key)
            if (value is String) out[key] = value else if (value is Number || value is Boolean) out[key] = value.toString()
        }
        return out
    }

    internal fun toNotification(title: String, body: String, data: Map<String, String>) = Notification(
        messageId = data["pingsell_message_id"],
        inboxId = data["pingsell_inbox_id"],
        title = title,
        body = body,
        url = data["url"],
        imageUrl = data["image_url"],
        data = data.filterKeys { !it.startsWith("google.") && !it.startsWith("gcm.") && it != "from" && it != HANDLED && it != "pingsell_title" && it != "pingsell_body" },
    )

    private fun <T> async(callback: (Result<T>) -> Unit, block: () -> T) {
        io.execute {
            val result = runCatching(block)
            main.post { callback(result) }
        }
    }

    /** Appel sans attente du résultat (enregistrement, ouverture…) : réessaie une fois en cas de coupure réseau. */
    private fun post(path: String, body: JSONObject, done: ((Boolean) -> Unit)? = null) {
        if (!ready()) return
        io.execute {
            var ok = false
            for (attempt in 0..1) {
                try {
                    call("POST", path, body)
                    ok = true
                    break
                } catch (e: PingsellException) {
                    log("$path : ${e.message}")
                    break
                } catch (e: Exception) {
                    log("$path : ${e.message}${if (attempt == 0) ", nouvel essai dans 10 s" else ""}")
                    if (attempt == 0) Thread.sleep(10_000)
                }
            }
            done?.invoke(ok)
        }
    }

    private fun call(method: String, path: String, body: JSONObject?): JSONObject {
        check(ready()) { "Pingsell : appelez Pingsell.initialize(context, appKey) d'abord" }
        val connection = URL("$apiUrl/api/v1$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Authorization", "Bearer $appKey")
            connection.setRequestProperty("Accept-Language", Locale.getDefault().toLanguageTag())
            connection.setRequestProperty("X-Pingsell-SDK", "pingsell-android/$SDK_VERSION")
            prefs.getString("token", null)?.let { connection.setRequestProperty("X-Pingsell-Device", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = if (text.isBlank()) JSONObject() else runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (status !in 200..299) {
                throw PingsellException(status, json.optStringOrNull("message") ?: json.optStringOrNull("error") ?: "Pingsell : erreur $status")
            }
            return json
        } finally {
            connection.disconnect()
        }
    }

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
}

/**
 * Pour une app qui n'a pas encore son propre service Firebase : déclarez-le dans le manifeste.
 * Une app qui en a déjà un appelle `Pingsell.setFCMToken` et `Pingsell.handleMessage` depuis le sien.
 */
open class PingsellMessagingService : com.google.firebase.messaging.FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Pingsell.setFCMToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Pingsell.handleMessage(this, message)
    }
}
