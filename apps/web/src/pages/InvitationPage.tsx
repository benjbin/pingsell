import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRight, CircleAlert } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { Button, Field, Input, Spinner } from "../components/ui/primitives";
import { Logo, ThemeToggle } from "../components/layout/AppLayout";
import { ROLES } from "./ProfilePage";
import { t } from "../lib/i18n";

/** Public page opened from the invitation email: create your access and join the account. */
export function InvitationPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { adopt, account: current, logout } = useAuth();
  const info = useAsync(() => api.invitations.get(token), [token]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (current) logout();
      await adopt(await api.invitations.accept(token, { name: name.trim(), password }));
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const inv = info.data;
  const role = inv ? ROLES[inv.role] : null;

  return (
    <div className="flex min-h-screen flex-col px-6 py-8 sm:px-12">
      <div className="flex items-center justify-between">
        <Logo />
        <ThemeToggle />
      </div>
      <div className="mx-auto flex w-full max-w-[420px] flex-1 animate-rise flex-col justify-center py-12">
        {info.loading && !inv ? (
          <Spinner className="mx-auto size-7" />
        ) : info.error || !inv ? (
          <div className="text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30">
              <CircleAlert className="size-6" />
            </span>
            <h1 className="display mt-5 text-[34px] leading-[0.95] text-slate-900 dark:text-white">{t("Invitation invalide", "Invalid invitation")}</h1>
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">{info.error ?? t("Ce lien ne fonctionne plus.", "This link no longer works.")}</p>
            <Link to="/connexion" className="mt-8 inline-block font-medium text-slate-950 underline decoration-brand-500 decoration-2 underline-offset-4 dark:text-white">
              {t("Aller à la connexion", "Go to sign in")}
            </Link>
          </div>
        ) : (
          <>
            <p className="eyebrow">{t("Invitation", "Invitation")}</p>
            <h1 className="display mt-4 text-[44px] leading-[0.9] text-slate-900 dark:text-white">
              {t(<>Rejoignez <em className="text-brand-500">{inv.account_name}.</em></>, <>Join <em className="text-brand-500">{inv.account_name}.</em></>)}
            </h1>
            <p className="mt-5 text-[15px] text-slate-600 dark:text-slate-400">
              {t(
                `${inv.invited_by ? `${inv.invited_by} vous invite` : "Vous êtes invité(e)"} à gérer les campagnes email de ${inv.account_name}.`,
                `${inv.invited_by ? `${inv.invited_by} invited you` : "You've been invited"} to manage ${inv.account_name}'s email campaigns.`,
              )}
            </p>
            {role && (
              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-slate-100 p-4 dark:bg-white/5">
                <role.icon className="mt-0.5 size-4 shrink-0 text-brand-500" />
                <div>
                  <p className="font-display text-sm font-bold text-slate-900 dark:text-white">{role.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{role.description}</p>
                </div>
              </div>
            )}

            {inv.email_taken ? (
              <p className="mt-8 rounded-xl border border-amber-300 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:text-amber-200">
                {t(`Un compte Pingsell existe déjà avec ${inv.email}. Demandez une invitation sur une autre adresse.`, `A Pingsell account already exists for ${inv.email}. Ask for an invitation to a different address.`)}
              </p>
            ) : (
              <form onSubmit={onSubmit} className="mt-8 space-y-5">
                <Field label={t("Adresse email", "Email address")} htmlFor="inv-email">
                  <Input id="inv-email" value={inv.email} disabled className="h-12" />
                </Field>
                <Field label={t("Votre nom", "Your name")} htmlFor="inv-name">
                  <Input id="inv-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Prénom Nom", "First Last")} autoComplete="name" autoFocus className="h-12" />
                </Field>
                <Field label={t("Choisissez un mot de passe", "Choose a password")} htmlFor="inv-password" hint={t("8 caractères minimum.", "At least 8 characters.")}>
                  <Input id="inv-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="h-12" />
                </Field>
                {error && <p className="rounded-xl border border-red-300 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:text-red-300">{error}</p>}
                <Button type="submit" size="lg" className="group w-full" loading={loading}>
                  {t("Rejoindre l'équipe", "Join the team")}
                  {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
