import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Missive, MissiveBadge, MissiveInAppBanner, MissiveInbox, MissivePermissionPrompt, useMissiveInbox, type InboxItem } from "@missive/expo-push";

const APP_KEY = process.env.EXPO_PUBLIC_MISSIVE_APP_KEY ?? "";
const API_URL = process.env.EXPO_PUBLIC_MISSIVE_API_URL ?? "http://localhost:4000";

let opened: ((item: { title: string; url: string | null }) => void) | null = null;

// 1. Initialise Missive once, outside components.
if (APP_KEY) {
  Missive.init({
    appKey: APP_KEY,
    apiUrl: API_URL,
    // In-app banner when the app is open; the OS shows lock-screen notifications otherwise.
    foreground: "banner",
    onOpen: (n) => opened?.({ title: n.title, url: n.url }),
  });
}

const PRODUCTS = [
  { name: "Manteau Laponie", price: "189 €", color: "#1e3a8a" },
  { name: "Pull Fjord", price: "79 €", color: "#b45309" },
  { name: "Bonnet Givre", price: "29 €", color: "#0f766e" },
  { name: "Écharpe Aurore", price: "39 €", color: "#9d174d" },
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
          <Text style={styles.h1}>Clé manquante</Text>
          <Text style={styles.p}>Copiez .env.example en .env et collez la clé msvapp_… de Missive (Notifications push › Configuration).</Text>
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
            <MissiveBadge>
              <Text style={{ fontSize: 22 }}>🔔</Text>
            </MissiveBadge>
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {tab === "shop" && <Shop last={last} />}
          {tab === "inbox" && <MissiveInbox onOpen={(item: InboxItem) => opened?.(item)} />}
          {tab === "account" && <Account />}
        </View>

        <TabBar tab={tab} onChange={setTab} />
        <MissiveInAppBanner />
        <MissivePermissionPrompt />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Shop({ last }: { last: string | null }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {last && (
        <View style={styles.notice}>
          <Text style={{ color: "#145cff", fontWeight: "700" }}>Ouvert depuis une notification</Text>
          <Text style={{ color: "#0b214a", marginTop: 2 }}>{last}</Text>
        </View>
      )}
      <Text style={styles.h1}>Collection hiver</Text>
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
  const [status, setStatus] = useState<string>(Missive.deviceToken ? "Notifications activées" : "Notifications désactivées");
  const [busy, setBusy] = useState(false);
  const inbox = useMissiveInbox();

  async function enable() {
    setBusy(true);
    // 2. Sign-in: link the phone to the customer (fires "Première connexion à l'app" automations).
    if (email.trim()) await Missive.identify({ email: email.trim() }).catch(() => undefined);
    // 3. Pre-permission screen, then the system dialog only if the customer tapped "Activer".
    const res = await Missive.requestPermission({ force: true });
    setBusy(false);
    if (res.ok) {
      setStatus(res.linked ? `Activées · liées à ${email}` : "Activées (client inconnu de Missive)");
      return;
    }
    if (res.reason === "declined") {
      setStatus("Plus tard : l'écran sera reproposé après le délai réglé dans Missive");
      return;
    }
    if (res.reason === "unsupported") {
      // Simulators cannot get a real push token: use a test token so the in-app centre works.
      Alert.alert("Simulateur détecté", "Utiliser un jeton de test ? Le centre de notifications fonctionnera ; l'écran verrouillé se teste avec xcrun simctl push.", [
        { text: "Annuler", style: "cancel" },
        {
          text: "Jeton de test",
          onPress: async () => {
            const r = await Missive.registerToken("ExponentPushToken[simulateur-atelier-nord]", { provider: "expo", email: email.trim() || undefined });
            setStatus(r.ok ? `Simulateur · ${r.linked ? `lié à ${email}` : "anonyme"}` : r.message);
          },
        },
      ]);
      return;
    }
    setStatus(res.message);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={styles.h1}>Mon compte</Text>
      <Text style={styles.label}>Email du client</Text>
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
      <Pressable accessibilityRole="button" onPress={() => void enable()} style={[styles.button, busy && { opacity: 0.6 }]} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? "…" : "Activer les notifications"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => void Missive.logout().then(() => setStatus("Déconnecté : l'appareil n'est plus lié au client"))}
        style={[styles.button, styles.secondary]}
      >
        <Text style={[styles.buttonText, { color: "#0b214a" }]}>Se déconnecter</Text>
      </Pressable>
      <View style={styles.notice}>
        <Text style={{ color: "#0b214a", fontWeight: "700" }}>{status}</Text>
        <Text style={styles.p}>Non lues : {inbox.unread}</Text>
        {Missive.deviceToken && <Text style={[styles.p, { fontSize: 12 }]}>Jeton : {Missive.deviceToken}</Text>}
      </View>
    </ScrollView>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { unread } = useMissiveInbox();
  const items: Array<[Tab, string]> = [
    ["shop", "Boutique"],
    ["inbox", unread ? `Notifications (${unread})` : "Notifications"],
    ["account", "Compte"],
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
