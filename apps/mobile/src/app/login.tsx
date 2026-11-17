import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { radius, spacing, useColors } from '@/lib/theme';

export default function LoginScreen() {
  const c = useColors();
  const { apiUrl: storedUrl, lastEmail, signIn } = useAuth();
  const [apiUrl, setApiUrl] = useState(storedUrl);
  const [email, setEmail] = useState(lastEmail);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && apiUrl.trim().length > 0;

  async function onSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(apiUrl, email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible');
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: c.accent }]}>
              <Ionicons name="paper-plane" size={26} color={c.onAccent} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>Missive</Text>
            <Text style={[styles.subtitle, { color: c.textMuted }]}>
              Connectez-vous pour suivre vos campagnes et vos contacts.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Field
              label="Adresse de l'API"
              value={apiUrl}
              onChangeText={setApiUrl}
              placeholder="http://localhost:4000"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint="Sur un iPhone physique, utilisez l'IP locale du Mac (ex. http://192.168.1.20:4000)."
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="vous@entreprise.fr"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
            />
            <Field
              label="Mot de passe"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

            {error ? (
              <View style={[styles.error, { backgroundColor: c.dangerSoft }]}>
                <Ionicons name="alert-circle" size={18} color={c.danger} />
                <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
              </View>
            ) : null}

            <Button label="Se connecter" onPress={onSubmit} loading={submitting} disabled={!canSubmit} />
          </View>

          <Text style={[styles.footer, { color: c.textSubtle }]}>
            Compte de démo : demo@missive.local (après « npm run seed » côté API)
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor={c.textSubtle}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surfaceMuted, borderColor: focused ? c.accentText : c.border },
        ]}
      />
      {hint ? <Text style={[styles.hint, { color: c.textSubtle }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center', gap: spacing.sm },
  logo: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xl, gap: spacing.lg },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16 },
  hint: { fontSize: 12, lineHeight: 16 },
  error: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  errorText: { flex: 1, fontSize: 14, lineHeight: 19 },
  footer: { fontSize: 12, textAlign: 'center' },
});
