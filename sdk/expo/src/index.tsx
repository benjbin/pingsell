import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Missive, type InboxItem, type InboxState, type MissiveNotification } from "./client";

export { Missive, ANDROID_CHANNEL_ID } from "./client";
export type { InboxItem, InboxState, MissiveConfig, MissiveNotification, RegisterOptions, RegisterResult } from "./client";

/** Live in-app notification centre: items, unread count and actions. */
export function useMissiveInbox(): InboxState & {
  refresh: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  open: (item: InboxItem) => void;
} {
  const state = useSyncExternalStore(Missive.subscribe, Missive.getState, Missive.getState);
  useEffect(() => {
    void Missive.refresh();
  }, []);
  return {
    ...state,
    refresh: () => Missive.refresh(),
    markRead: (ids) => Missive.markRead(ids),
    remove: (ids) => Missive.remove(ids),
    open: (item) => Missive.open(item),
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

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "À l'instant";
  if (s < 3600) return `Il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `Il y a ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86_400) return `Il y a ${Math.floor(s / 86_400)} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Notification centre screen: pull to refresh, unread dots, "mark all as read". */
export function MissiveInbox({
  title = "Notifications",
  emptyText = "Aucune notification pour le moment.",
  theme,
  style,
  onOpen,
}: {
  title?: string | null;
  emptyText?: string;
  theme?: Theme;
  style?: StyleProp<ViewStyle>;
  /** Overrides the default action (Missive.init onOpen, or opening the link). */
  onOpen?: (item: InboxItem) => void;
}) {
  const t = { ...DEFAULT_THEME, ...theme };
  const inbox = useMissiveInbox();

  return (
    <View style={[{ flex: 1, backgroundColor: t.background }, style]}>
      {title !== null && (
        <View style={styles.header}>
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          {inbox.unread > 0 && (
            <Pressable accessibilityRole="button" onPress={() => void inbox.markRead()} hitSlop={8}>
              <Text style={{ color: t.accent, fontWeight: "600" }}>Tout marquer comme lu</Text>
            </Pressable>
          )}
        </View>
      )}
      {!inbox.ready ? (
        <Text style={[styles.empty, { color: t.muted }]}>Activez les notifications pour retrouver vos messages ici.</Text>
      ) : inbox.loading && !inbox.items.length ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={t.accent} />
      ) : (
        <FlatList
          data={inbox.items}
          keyExtractor={(i) => i.id}
          refreshControl={<RefreshControl refreshing={inbox.loading} onRefresh={() => void inbox.refresh()} tintColor={t.accent} />}
          ListEmptyComponent={<Text style={[styles.empty, { color: t.muted }]}>{inbox.error ?? emptyText}</Text>}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.read ? "" : "Non lue. "}${item.title}. ${item.body}`}
              onPress={() => {
                if (onOpen) {
                  void inbox.markRead([item.id]);
                  onOpen(item);
                } else inbox.open(item);
              }}
              style={({ pressed }) => [
                styles.item,
                { backgroundColor: item.read ? "#f8fafc" : t.unreadBackground, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: t.text, fontWeight: item.read ? "500" : "700" }]}>{item.title}</Text>
                <Text style={[styles.itemBody, { color: t.muted }]}>{item.body}</Text>
                {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="cover" /> : null}
                <Text style={[styles.time, { color: t.muted }]}>{timeAgo(item.created_at)}</Text>
              </View>
              {!item.read && <View style={[styles.dot, { backgroundColor: t.accent }]} />}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

/** Small red counter to put on your bell icon: <MissiveBadge><BellIcon /></MissiveBadge>. */
export function MissiveBadge({ children, color = "#ef4444" }: { children: ReactNode; color?: string }) {
  const { unread } = useSyncExternalStore(Missive.subscribe, Missive.getState, Missive.getState);
  return (
    <View>
      {children}
      {unread > 0 && (
        <View style={[styles.badge, { backgroundColor: color }]} accessibilityLabel={`${unread} notification(s) non lue(s)`}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Banner shown inside the app when a notification arrives while it is open
 * (Missive.init({ foreground: "banner" })). Render it once, at the root.
 */
export function MissiveInAppBanner({ duration = 5000, theme, top = 54 }: { duration?: number; theme?: Theme; top?: number }) {
  const t = { ...DEFAULT_THEME, ...theme };
  const [current, setCurrent] = useState<MissiveNotification | null>(null);
  const y = useRef(new Animated.Value(-200)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () =>
      Animated.timing(y, { toValue: -200, duration: 220, useNativeDriver: true }).start(() => setCurrent(null));
    const off = Missive.onBanner((n) => {
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
          Missive.openBanner(current);
          y.setValue(-200);
          setCurrent(null);
        }}
        style={[styles.banner, { backgroundColor: t.background }]}
      >
        <View style={[styles.bannerIcon, { backgroundColor: t.accent }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemTitle, { color: t.text }]} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={[styles.itemBody, { color: t.muted }]} numberOfLines={2}>
            {current.body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
