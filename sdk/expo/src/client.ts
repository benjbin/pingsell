import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Linking, Platform } from "react-native";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface MissiveConfig {
  /** Public app key, `msvapp_…` (Missive › Notifications push › Configuration). */
  appKey: string;
  /** Missive API origin, e.g. https://api.missive.fr (without /api/v1). */
  apiUrl: string;
  /**
   * `expo` (default): Expo push token, works without Firebase / APNs setup on your side.
   * `device`: native APNs (iOS) / FCM (Android) token, sent through your own keys saved in Missive.
   */
  tokenType?: "expo" | "device";
  /** EAS project id, required for Expo tokens outside Expo Go (defaults to app config extra.eas.projectId). */
  projectId?: string;
  /**
   * What happens when a notification arrives while the app is open:
   * `system` (default) shows the OS banner, `banner` shows <MissiveInAppBanner />, `none` only updates the inbox.
   */
  foreground?: "system" | "banner" | "none";
  /** Called when the customer taps a notification (OS or in-app). Defaults to opening its `url`. */
  onOpen?: (notification: MissiveNotification) => void;
  /** Keep the app icon badge equal to the unread in-app notifications (default: true). */
  syncBadge?: boolean;
  /** Android channel name shown in the system settings (default: "Notifications"). */
  androidChannelName?: string;
}

export interface MissiveNotification {
  /** In-app inbox id (when the notification is also kept in the notification centre). */
  id: string | null;
  messageId: string | null;
  title: string;
  body: string;
  url: string | null;
  imageUrl: string | null;
}

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  url: string | null;
  created_at: string;
  read: boolean;
}

export interface InboxState {
  items: InboxItem[];
  unread: number;
  loading: boolean;
  error: string | null;
  /** True once the device is registered and the inbox can be fetched. */
  ready: boolean;
}

export interface RegisterOptions {
  /** Signed-in customer: links this phone to their Missive contact (segments, automations, history). */
  email?: string;
  contactId?: string;
  /** HMAC-SHA256 of the email, computed by YOUR server (required when identity verification is on). */
  userHash?: string;
  appVersion?: string;
  /** Ask for the notification permission if not granted yet (default: true). */
  askPermission?: boolean;
}

export type RegisterResult =
  | { ok: true; token: string; linked: boolean }
  | { ok: false; reason: "permission_denied" | "unsupported" | "error"; message: string };

/** Android channel used by Missive notifications (high importance, full content on the lock screen). */
export const ANDROID_CHANNEL_ID = "missive";

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

class MissiveClient {
  private config: MissiveConfig | null = null;
  private token: string | null = null;
  private subscriptions: Array<{ remove: () => void }> = [];
  private state: InboxState = { items: [], unread: 0, loading: false, error: null, ready: false };
  private stateListeners = new Set<Listener>();
  private bannerListeners = new Set<(n: MissiveNotification) => void>();
  private refreshing: Promise<void> | null = null;

  /** Call once, as early as possible (outside components, e.g. in App.tsx / _layout.tsx). */
  init(config: MissiveConfig): void {
    if (this.config) return;
    if (!config.appKey?.startsWith("msvapp_")) throw new Error("Missive : clé d'application invalide (msvapp_…)");
    this.config = { foreground: "system", syncBadge: true, tokenType: "expo", ...config, apiUrl: config.apiUrl.replace(/\/+$/, "") };

    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const n = toMissive(notification.request);
        if (n.messageId || n.id) {
          void this.refresh();
          if (this.config?.foreground === "banner") this.bannerListeners.forEach((l) => l(n));
        }
        const showSystem = this.config?.foreground === "system" || !(n.messageId || n.id);
        return { shouldShowBanner: showSystem, shouldShowList: true, shouldPlaySound: showSystem, shouldSetBadge: true };
      },
    });

    // Tap on a notification: app in background, or cold start.
    this.subscriptions.push(
      Notifications.addNotificationResponseReceivedListener((response) => this.handleTap(toMissive(response.notification.request))),
    );
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) this.handleTap(toMissive(response.notification.request));
    });

    // Back to the foreground: the inbox may have changed (sent while the phone was offline).
    this.subscriptions.push(AppState.addEventListener("change", (s) => s === "active" && void this.refresh()));

    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: config.androidChannelName ?? "Notifications",
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        showBadge: true,
      });
    }
  }

  /** Current device push token (after `register`). */
  get deviceToken(): string | null {
    return this.token;
  }

  /**
   * Asks for permission, gets the push token and registers the phone with Missive.
   * Call it at every launch (it is idempotent) and again after the customer signs in.
   */
  async register(options: RegisterOptions = {}): Promise<RegisterResult> {
    const config = this.requireConfig();
    try {
      let { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted" && options.askPermission !== false) {
        ({ status } = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        }));
      }
      if (status !== "granted") {
        return { ok: false, reason: "permission_denied", message: "Notifications refusées dans les réglages du téléphone" };
      }
      const { token, provider } = await this.fetchToken(config);
      return await this.registerToken(token, { ...options, provider });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const unsupported = /simulator|emulator|physical device|projectId/i.test(message);
      return { ok: false, reason: unsupported ? "unsupported" : "error", message };
    }
  }

  /**
   * Registers a token you obtained yourself (e.g. from @react-native-firebase/messaging),
   * or a test token on a simulator. Most apps use `register()` instead.
   */
  async registerToken(token: string, options: RegisterOptions & { provider?: "expo" | "fcm" | "apns" } = {}): Promise<RegisterResult> {
    const res = await this.request<{ linked: boolean }>("POST", "/push/app/devices", {
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.email ? { email: options.email } : {}),
      ...(options.contactId ? { contact_id: options.contactId } : {}),
      ...(options.userHash ? { user_hash: options.userHash } : {}),
      app_version: options.appVersion ?? Constants.expoConfig?.version ?? undefined,
    });
    this.token = token;
    this.setState({ ready: true });
    await this.refresh();
    return { ok: true, token, linked: res.linked };
  }

  /** The customer signed out: keep notifications for this phone but forget who it belongs to. */
  async logout(): Promise<void> {
    if (!this.token) return;
    await this.request("POST", "/push/app/devices/logout", { token: this.token });
    await this.refresh();
  }

  /** The customer disabled notifications in your app. */
  async unregister(): Promise<void> {
    if (!this.token) return;
    await this.request("POST", "/push/app/devices/unregister", { token: this.token });
    this.token = null;
    this.setState({ items: [], unread: 0, ready: false });
    await this.syncBadge(0);
  }

  /* ---------------------------- In-app inbox ---------------------------- */

  getState = (): InboxState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  /** Reloads the notification centre (deduplicated while a refresh is running). */
  refresh(): Promise<void> {
    if (!this.token || !this.config) return Promise.resolve();
    this.refreshing ??= (async () => {
      this.setState({ loading: true, error: null });
      try {
        const res = await this.request<{ data: InboxItem[]; unread: number }>("GET", "/push/app/inbox?limit=50");
        this.setState({ items: res.data, unread: res.unread, loading: false });
        await this.syncBadge(res.unread);
      } catch (err) {
        this.setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Marks items as read (all when `ids` is omitted). */
  async markRead(ids?: string[]): Promise<void> {
    if (!this.token) return;
    const target = new Set(ids ?? this.state.items.map((i) => i.id));
    const items = this.state.items.map((i) => (target.has(i.id) ? { ...i, read: true } : i));
    this.setState({ items, unread: ids ? items.filter((i) => !i.read).length : 0 });
    const res = await this.request<{ unread: number }>("POST", "/push/app/inbox/read", ids ? { ids } : {});
    this.setState({ unread: res.unread });
    await this.syncBadge(res.unread);
  }

  async remove(ids: string[]): Promise<void> {
    if (!this.token || !ids.length) return;
    const drop = new Set(ids);
    this.setState({ items: this.state.items.filter((i) => !drop.has(i.id)) });
    const res = await this.request<{ unread: number }>("POST", "/push/app/inbox/delete", { ids });
    this.setState({ unread: res.unread });
    await this.syncBadge(res.unread);
  }

  /** Opens an inbox item: marks it read and runs `onOpen` (or opens its link). */
  open(item: InboxItem): void {
    void this.markRead([item.id]);
    this.dispatchOpen({ id: item.id, messageId: null, title: item.title, body: item.body, url: item.url, imageUrl: item.image_url });
  }

  /** Used by <MissiveInAppBanner /> (foreground: "banner"). */
  onBanner(listener: (n: MissiveNotification) => void): () => void {
    this.bannerListeners.add(listener);
    return () => this.bannerListeners.delete(listener);
  }

  /* ------------------------------ Internals ----------------------------- */

  private handleTap(n: MissiveNotification): void {
    if (!n.messageId && !n.id) return;
    if (n.messageId) void this.request("POST", "/push/app/opened", { message_id: n.messageId }).then(() => this.refresh()).catch(() => undefined);
    this.dispatchOpen(n);
  }

  /** In-app banner tap. */
  openBanner(n: MissiveNotification): void {
    if (n.id) void this.markRead([n.id]);
    if (n.messageId) void this.request("POST", "/push/app/opened", { message_id: n.messageId }).catch(() => undefined);
    this.dispatchOpen(n);
  }

  private dispatchOpen(n: MissiveNotification): void {
    if (this.config?.onOpen) this.config.onOpen(n);
    else if (n.url) void Linking.openURL(n.url).catch(() => undefined);
  }

  private async fetchToken(config: MissiveConfig): Promise<{ token: string; provider: "expo" | "fcm" | "apns" }> {
    if (config.tokenType === "device") {
      const t = await Notifications.getDevicePushTokenAsync();
      return { token: String(t.data), provider: Platform.OS === "ios" ? "apns" : "fcm" };
    }
    const projectId =
      config.projectId ??
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return { token: t.data, provider: "expo" };
  }

  private async syncBadge(unread: number): Promise<void> {
    if (this.config?.syncBadge === false) return;
    await Notifications.setBadgeCountAsync(unread).catch(() => undefined);
  }

  private setState(patch: Partial<InboxState>): void {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((l) => l());
  }

  private requireConfig(): MissiveConfig {
    if (!this.config) throw new Error("Missive : appelez Missive.init({ appKey, apiUrl }) avant toute autre méthode");
    return this.config;
  }

  private async request<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const config = this.requireConfig();
    const res = await fetch(`${config.apiUrl}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.appKey}`,
        ...(this.token ? { "x-missive-device": this.token } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) throw new Error(data.message ?? data.error ?? `Missive : erreur ${res.status}`);
    return data;
  }
}

function toMissive(request: Notifications.NotificationRequest): MissiveNotification {
  const content = request.content;
  const data = (content.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: str(data.missive_inbox_id),
    messageId: str(data.missive_message_id),
    title: content.title ?? "",
    body: content.body ?? "",
    url: str(data.url),
    imageUrl: str(data.image_url),
  };
}

/** Singleton used by the hooks and components. */
export const Missive = new MissiveClient();
