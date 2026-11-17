import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Pingsell, PingsellBadge, PingsellInAppBanner, PingsellInbox, PingsellPermissionPrompt, usePingsellInbox, type InboxItem } from "@pingsell/expo-push";

const APP_KEY = process.env.EXPO_PUBLIC_PINGSELL_APP_KEY ?? "";
const API_URL = process.env.EXPO_PUBLIC_PINGSELL_API_URL ?? "http://localhost:4000";

// Demo texts in French or English, same language as the SDK (device language, or `locale` passed to Pingsell.init).
const t = <T,>(fr: T, en: T): T => (Pingsell.locale === "en" ? en : fr);

let opened: ((item: { title: string; url: string | null }) => void) | null = null;

// 1. Initialise Pingsell once, outside components.
if (APP_KEY) {
  Pingsell.init({
    appKey: APP_KEY,
    apiUrl: API_URL,
    // In-app banner when the app is open; the OS shows lock-screen notifications otherwise.
    foreground: "banner",
    onOpen: (n) => opened?.({ title: n.title, url: n.url }),
  });
}

const PRODUCTS = [
  { name: t("Manteau Laponie", "Lapland Coat"), price: t("189 €", "€189"), color: "#1e3a8a" },
  { name: t("Pull Fjord", "Fjord Sweater"), price: t("79 €", "€79"), color: "#b45309" },
  { name: t("Bonnet Givre", "Frost Beanie"), price: t("29 €", "€29"), color: "#0f766e" },
  { name: t("Écharpe Aurore", "Aurora Scarf"), price: t("39 €", "€39"), color: "#9d174d" },
];

type Tab = "shop" | "inbox" | "account";

export default function App() {
  const [tab, setTab] = useState<Tab>("shop");
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    // Where a tapped notification (lock screen, banner or inbox) takes the customer.
    opened = (item) => {
      setLast(`${item.title}${item.url ? ` → ${item.url}` : ""}`);
      setTab("shop");
    };
    return () => {
      opened = null;
    };
  }, []);

  if (!APP_KEY) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.screen, { padding: 24 }]}>
          <Text style={styles.h1}>{t("Clé manquante", "Missing key")}</Text>
          <Text style={styles.p}>
            {t(
              "Copiez .env.example en .env et collez la clé msvapp_… de Pingsell (Notifications push › Configuration).",
              "Copy .env.example to .env and paste your msvapp_… key from Pingsell (Push notifications › Setup).",
            )}
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <StatusBar style="dark" />
        <View style={styles.topbar}>
          <Text style={styles.brand}>ATELIER NORD</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={() => setTab("inbox")} hitSlop={10}>
            <PingsellBadge>
              <Text style={{ fontSize: 22 }}>🔔</Text>
            </PingsellBadge>
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {tab === "shop" && <Shop last={last} />}
          {tab === "inbox" && <PingsellInbox onOpen={(item: InboxItem) => opened?.(item)} />}
          {tab === "account" && <Account />}
        </View>

        <TabBar tab={tab} onChange={setTab} />
        <PingsellInAppBanner />
        <PingsellPermissionPrompt />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Shop({ last }: { last: string | null }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {last && (
        <View style={styles.notice}>
          <Text style={{ color: "#145cff", fontWeight: "700" }}>{t("Ouvert depuis une notification", "Opened from a notification")}</Text>
          <Text style={{ color: "#0b214a", marginTop: 2 }}>{last}</Text>
        </View>
      )}
      <Text style={styles.h1}>{t("Collection hiver", "Winter collection")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {PRODUCTS.map((p) => (
          <View key={p.name} style={styles.card}>
            <View style={[styles.swatch, { backgroundColor: p.color }]} />
            <Text style={styles.productName}>{p.name}</Text>
            <Text style={styles.p}>{p.price}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Account() {
  const [email, setEmail] = useState("arthur.thomas@example.org");
  const [status, setStatus] = useState<string>(
    Pingsell.deviceToken ? t("Notifications activées", "Notifications on") : t("Notifications désactivées", "Notifications off"),
  );
  const [busy, setBusy] = useState(false);
  const inbox = usePingsellInbox();

  async function enable() {
    setBusy(true);
    // 2. Sign-in: link the phone to the customer (fires "Première connexion à l'app" automations).
    if (email.trim()) await Pingsell.identify({ email: email.trim() }).catch(() => undefined);
    // 3. Pre-permission screen, then the system dialog only if the customer tapped "Activer".
    const res = await Pingsell.requestPermission({ force: true });
    setBusy(false);
    if (res.ok) {
      setStatus(
        res.linked
          ? t(`Activées · liées à ${email}`, `On · linked to ${email}`)
          : t("Activées (client inconnu de Pingsell)", "On (customer unknown to Pingsell)"),
      );
      return;
    }
    if (res.reason === "declined") {
      setStatus(
        t(
          "Plus tard : l'écran sera reproposé après le délai réglé dans Pingsell",
          "Not now: the screen will be shown again after the delay set in Pingsell",
        ),
      );
      return;
    }
    if (res.reason === "unsupported") {
      // Simulators cannot get a real push token: use a test token so the in-app centre works.
      Alert.alert(
        t("Simulateur détecté", "Simulator detected"),
        t(
          "Utiliser un jeton de test ? Le centre de notifications fonctionnera ; l'écran verrouillé se teste avec xcrun simctl push.",
          "Use a test token? The notification center will work; test the lock screen with xcrun simctl push.",
        ),
        [
        { text: t("Annuler", "Cancel"), style: "cancel" },
        {
          text: t("Jeton de test", "Test token"),
          onPress: async () => {
            const r = await Pingsell.registerToken("ExponentPushToken[simulateur-atelier-nord]", { provider: "expo", email: email.trim() || undefined });
            setStatus(
              r.ok
                ? t(
                    `Simulateur · ${r.linked ? `lié à ${email}` : "anonyme"}`,
                    `Simulator · ${r.linked ? `linked to ${email}` : "anonymous"}`,
                  )
                : r.message,
            );
          },
        },
      ]);
      return;
    }
    setStatus(res.message);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={styles.h1}>{t("Mon compte", "My account")}</Text>
      <Text style={styles.label}>{t("Email du client", "Customer email")}</Text>
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
      <Pressable accessibilityRole="button" onPress={() => void enable()} style={[styles.button, busy && { opacity: 0.6 }]} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? "…" : t("Activer les notifications", "Turn on notifications")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => void Pingsell.logout().then(() => setStatus(t("Déconnecté : l'appareil n'est plus lié au client", "Signed out: this device is no longer linked to the customer")))}
        style={[styles.button, styles.secondary]}
      >
        <Text style={[styles.buttonText, { color: "#0b214a" }]}>{t("Se déconnecter", "Sign out")}</Text>
      </Pressable>
      <View style={styles.notice}>
        <Text style={{ color: "#0b214a", fontWeight: "700" }}>{status}</Text>
        <Text style={styles.p}>{t(`Non lues : ${inbox.unread}`, `Unread: ${inbox.unread}`)}</Text>
        {Pingsell.deviceToken && <Text style={[styles.p, { fontSize: 12 }]}>{t(`Jeton : ${Pingsell.deviceToken}`, `Token: ${Pingsell.deviceToken}`)}</Text>}
      </View>
    </ScrollView>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (next: Tab) => void }) {
  const { unread } = usePingsellInbox();
  const items: Array<[Tab, string]> = [
    ["shop", t("Boutique", "Shop")],
    ["inbox", unread ? `Notifications (${unread})` : "Notifications"],
    ["account", t("Compte", "Account")],
  ];
  return (
    <SafeAreaView edges={["bottom"]} style={styles.tabbar}>
      {items.map(([key, label]) => (
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => onChange(key)} style={styles.tab}>
          <Text style={[styles.tabText, tab === key && { color: "#145cff" }]}>{label}</Text>
        </Pressable>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#e2e8f0" },
  brand: { fontSize: 18, fontWeight: "900", letterSpacing: 1, color: "#0b214a" },
  h1: { fontSize: 26, fontWeight: "800", color: "#0b214a" },
  p: { fontSize: 14, color: "#64748b", marginTop: 2 },
  card: { width: "47%", backgroundColor: "#f8fafc", borderRadius: 16, padding: 10 },
  swatch: { height: 120, borderRadius: 12, marginBottom: 8 },
  productName: { fontSize: 15, fontWeight: "700", color: "#0b214a" },
  notice: { backgroundColor: "#eef3ff", borderRadius: 14, padding: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  input: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, padding: 12, fontSize: 15 },
  button: { backgroundColor: "#145cff", borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderColor: "#e2e8f0" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { fontSize: 13, fontWeight: "600", color: "#64748b" },
});
