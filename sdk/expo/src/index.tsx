import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Pingsell, type InboxItem, type InboxState, type PingsellNotification, type PromptSettings } from "./client";
import { getLocale, intlLocale, t, type PingsellLocale } from "./i18n";

export { Pingsell, ANDROID_CHANNEL_ID } from "./client";
export type { PingsellLocale } from "./i18n";
export type { Identity, InboxItem, InboxState, PingsellConfig, PingsellNotification, PromptSettings, RegisterOptions, RegisterResult } from "./client";

/** Live in-app notification centre: items, unread count and actions. */
export function usePingsellInbox(): InboxState & {
  refresh: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  open: (item: InboxItem) => void;
} {
  const state = useSyncExternalStore(Pingsell.subscribe, Pingsell.getState, Pingsell.getState);
  useEffect(() => {
    void Pingsell.refresh();
  }, []);
  return {
    ...state,
    refresh: () => Pingsell.refresh(),
    markRead: (ids) => Pingsell.markRead(ids),
    remove: (ids) => Pingsell.remove(ids),
    open: (item) => Pingsell.open(item),
  };
}

export interface Theme {
  accent?: string;
  text?: string;
  muted?: string;
  background?: string;
  unreadBackground?: string;
}

const DEFAULT_THEME: Required<Theme> = {
  accent: "#145cff",
  text: "#0b214a",
  muted: "#64748b",
  background: "#ffffff",
  unreadBackground: "#eef3ff",
};

function timeAgo(iso: string, locale: PingsellLocale): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("À l'instant", "Just now", locale);
  if (s < 3600) return t(`Il y a ${Math.floor(s / 60)} min`, `${Math.floor(s / 60)} min ago`, locale);
  if (s < 86_400) return t(`Il y a ${Math.floor(s / 3600)} h`, `${Math.floor(s / 3600)}h ago`, locale);
  if (s < 7 * 86_400) return t(`Il y a ${Math.floor(s / 86_400)} j`, `${Math.floor(s / 86_400)}d ago`, locale);
  return new Date(iso).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short" });
}

/** Notification centre screen: pull to refresh, unread dots, "mark all as read". */
export function PingsellInbox({
  title = "Notifications",
  emptyText,
  theme,
  style,
  onOpen,
  locale = getLocale(),
}: {
  title?: string | null;
  /** Empty-state text (default: translated "No notifications yet."). */
  emptyText?: string;
  /** Language of the built-in texts (default: Pingsell.init `locale`, otherwise the device language). */
  locale?: PingsellLocale;
  theme?: Theme;
  style?: StyleProp<ViewStyle>;
  /** Overrides the default action (Pingsell.init onOpen, or opening the link). */
  onOpen?: (item: InboxItem) => void;
}) {
  const th = { ...DEFAULT_THEME, ...theme };
  const inbox = usePingsellInbox();

  return (
    <View style={[{ flex: 1, backgroundColor: th.background }, style]}>
      {title !== null && (
        <View style={styles.header}>
          <Text style={[styles.title, { color: th.text }]}>{title}</Text>
          {inbox.unread > 0 && (
            <Pressable accessibilityRole="button" onPress={() => void inbox.markRead()} hitSlop={8}>
              <Text style={{ color: th.accent, fontWeight: "600" }}>{t("Tout marquer comme lu", "Mark all as read", locale)}</Text>
            </Pressable>
          )}
        </View>
      )}
      {!inbox.ready ? (
        <Text style={[styles.empty, { color: th.muted }]}>
          {t("Activez les notifications pour retrouver vos messages ici.", "Turn on notifications to see your messages here.", locale)}
        </Text>
      ) : inbox.loading && !inbox.items.length ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={th.accent} />
      ) : (
        <FlatList
          data={inbox.items}
          keyExtractor={(i) => i.id}
          refreshControl={<RefreshControl refreshing={inbox.loading} onRefresh={() => void inbox.refresh()} tintColor={th.accent} />}
          ListEmptyComponent={<Text style={[styles.empty, { color: th.muted }]}>{inbox.error ?? emptyText ?? t("Aucune notification pour le moment.", "No notifications yet.", locale)}</Text>}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.read ? "" : t("Non lue. ", "Unread. ", locale)}${item.title}. ${item.body}`}
              onPress={() => {
                if (onOpen) {
                  void inbox.markRead([item.id]);
                  onOpen(item);
                } else inbox.open(item);
              }}
              style={({ pressed }) => [
                styles.item,
                { backgroundColor: item.read ? "#f8fafc" : th.unreadBackground, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: th.text, fontWeight: item.read ? "500" : "700" }]}>{item.title}</Text>
                <Text style={[styles.itemBody, { color: th.muted }]}>{item.body}</Text>
                {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="cover" /> : null}
                <Text style={[styles.time, { color: th.muted }]}>{timeAgo(item.created_at, locale)}</Text>
              </View>
              {!item.read && <View style={[styles.dot, { backgroundColor: th.accent }]} />}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

/** Small red counter to put on your bell icon: <PingsellBadge><BellIcon /></PingsellBadge>. */
export function PingsellBadge({
  children,
  color = "#ef4444",
  locale = getLocale(),
}: {
  children: ReactNode;
  color?: string;
  /** Language of the accessibility label (default: Pingsell.init `locale`, otherwise the device language). */
  locale?: PingsellLocale;
}) {
  const { unread } = useSyncExternalStore(Pingsell.subscribe, Pingsell.getState, Pingsell.getState);
  return (
    <View>
      {children}
      {unread > 0 && (
        <View style={[styles.badge, { backgroundColor: color }]} accessibilityLabel={t(
            `${unread} notification(s) non lue(s)`,
            `${unread} unread notification${unread === 1 ? "" : "s"}`,
            locale,
          )}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Banner shown inside the app when a notification arrives while it is open
 * (Pingsell.init({ foreground: "banner" })). Render it once, at the root.
 */
export function PingsellInAppBanner({ duration = 5000, theme, top = 54 }: { duration?: number; theme?: Theme; top?: number }) {
  const th = { ...DEFAULT_THEME, ...theme };
  const [current, setCurrent] = useState<PingsellNotification | null>(null);
  const y = useRef(new Animated.Value(-200)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () =>
      Animated.timing(y, { toValue: -200, duration: 220, useNativeDriver: true }).start(() => setCurrent(null));
    const off = Pingsell.onBanner((n) => {
      setCurrent(n);
      y.setValue(-200);
      Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, duration);
    });
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [duration, y]);

  if (!current) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.bannerWrap, { top, transform: [{ translateY: y }] }]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          Pingsell.openBanner(current);
          y.setValue(-200);
          setCurrent(null);
        }}
        style={[styles.banner, { backgroundColor: th.background }]}
      >
        <View style={[styles.bannerIcon, { backgroundColor: th.accent }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemTitle, { color: th.text }]} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={[styles.itemBody, { color: th.muted }]} numberOfLines={2}>
            {current.body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Pre-permission screen shown by Pingsell.requestPermission() before the system dialog.
 * Its text comes from Pingsell (no app update needed to change it). Render it once, at the root.
 */
export function PingsellPermissionPrompt({ theme }: { theme?: Theme }) {
  const th = { ...DEFAULT_THEME, ...theme };
  const [prompt, setPrompt] = useState<PromptSettings | null>(null);
  useEffect(() => Pingsell.onPrompt(setPrompt), []);

  return (
    <Modal visible={!!prompt} transparent animationType="slide" onRequestClose={() => Pingsell.answerPrompt(false)}>
      <View style={styles.promptBackdrop}>
        {prompt && (
          <View style={[styles.promptCard, { backgroundColor: th.background }]} accessibilityViewIsModal>
            {prompt.image_url ? (
              <Image source={{ uri: prompt.image_url }} style={styles.promptImage} resizeMode="cover" />
            ) : (
              <View style={[styles.promptIcon, { backgroundColor: th.unreadBackground }]}>
                <Text style={{ fontSize: 30 }}>🔔</Text>
              </View>
            )}
            <Text style={[styles.promptTitle, { color: th.text }]}>{prompt.title}</Text>
            <Text style={[styles.promptBody, { color: th.muted }]}>{prompt.body}</Text>
            <Pressable accessibilityRole="button" onPress={() => Pingsell.answerPrompt(true)} style={[styles.promptPrimary, { backgroundColor: th.accent }]}>
              <Text style={styles.promptPrimaryText}>{prompt.accept_label}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => Pingsell.answerPrompt(false)} style={styles.promptSecondary} hitSlop={8}>
              <Text style={{ color: th.muted, fontWeight: "600", fontSize: 15 }}>{prompt.decline_label}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  promptBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,33,74,0.45)" },
  promptCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40, alignItems: "center" },
  promptIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  promptImage: { width: "100%", height: 150, borderRadius: 18, marginBottom: 16 },
  promptTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  promptBody: { fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 22 },
  promptPrimary: { alignSelf: "stretch", borderRadius: 999, paddingVertical: 15, alignItems: "center" },
  promptPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  promptSecondary: { paddingVertical: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: "800" },
  empty: { textAlign: "center", marginTop: 48, paddingHorizontal: 32, fontSize: 15 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 16, padding: 14 },
  itemTitle: { fontSize: 15 },
  itemBody: { fontSize: 14, marginTop: 2, lineHeight: 19 },
  image: { height: 120, borderRadius: 10, marginTop: 8 },
  time: { fontSize: 12, marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
  badge: { position: "absolute", top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  bannerWrap: { position: "absolute", left: 10, right: 10, zIndex: 1000 },
  banner: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderRadius: 18,
    padding: 14,
    shadowColor: "#0b214a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  bannerIcon: { width: 36, height: 36, borderRadius: 10 },
});
