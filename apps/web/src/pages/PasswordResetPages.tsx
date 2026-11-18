import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Eye, EyeOff, MailCheck, TriangleAlert } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Field, Input, Spinner } from "../components/ui/primitives";
import { AuthShell } from "./AuthPage";
import { t } from "../lib/i18n";

function BackToLogin() {
  return (
    <Link to="/connexion" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
      <ArrowLeft className="size-4" /> {t("Retour à la connexion", "Back to log in")}
    </Link>
  );
}

function ErrorBox({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-xl border border-red-300 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
      {children}
    </p>
  );
}

/** « Mot de passe oublié » : asks for the email, then says to check the inbox. */
export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.forgotPassword(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="mx-auto flex w-full max-w-[400px] flex-1 animate-rise flex-col justify-center py-12">
        <BackToLogin />
        {sentTo ? (
          <>
            <span className="mt-10 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-900/30">
              <MailCheck className="size-7" strokeWidth={1.75} />
            </span>
            <h1 className="display mt-6 text-[44px] leading-[0.9] text-slate-900 dark:text-white">
              {t(<>Regardez <em className="text-brand-500">vos emails.</em></>, <>Check <em className="text-brand-500">your inbox.</em></>)}
            </h1>
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
              {t("Si un compte existe pour ", "If an account exists for ")}
              <strong className="font-medium text-slate-900 dark:text-white">{sentTo}</strong>
              {t(
                ", vous allez recevoir un lien pour choisir un nouveau mot de passe. Il est valable 1 heure.",
                ", you'll receive a link to choose a new password. It's valid for 1 hour.",
              )}
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li>• {t("Rien reçu après quelques minutes ? Regardez dans vos spams.", "Nothing after a few minutes? Check your spam folder.")}</li>
              <li>• {t("Vérifiez que c'est bien l'adresse utilisée pour vous connecter.", "Make sure it's the address you log in with.")}</li>
            </ul>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="mt-8 self-start text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("Essayer une autre adresse", "Try another address")}
            </button>
          </>
        ) : (
          <>
            <h1 className="display mt-10 text-[44px] leading-[0.9] text-slate-900 dark:text-white">
              {t(<>Mot de passe <em className="text-brand-500">oublié ?</em></>, <>Forgot your <em className="text-brand-500">password?</em></>)}
            </h1>
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
              {t(
                "Pas de souci. Indiquez l'adresse email de votre compte, nous vous envoyons un lien pour en choisir un nouveau.",
                "No problem. Enter your account's email address and we'll send you a link to choose a new one.",
              )}
            </p>
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <Field label={t("Adresse email", "Email address")} htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("vous@exemple.fr", "you@example.com")}
                  autoComplete="email"
                  className="h-12"
                />
              </Field>
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button type="submit" size="lg" className="group w-full" loading={loading}>
                {t("Recevoir le lien", "Send me the link")}
                {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
}

/** Link from the email: choose the new password, then you're signed in. */
export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const { adopt } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "valid" | "invalid">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.auth
      .checkResetToken(token)
      .then((r) => {
        setEmail(r.email);
        setState("valid");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("Les deux mots de passe ne sont pas identiques.", "The two passwords don't match."));
      return;
    }
    setLoading(true);
    try {
      const res = await api.auth.resetPassword(token, password);
      await adopt(res);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="mx-auto flex w-full max-w-[400px] flex-1 animate-rise flex-col justify-center py-12">
        <BackToLogin />
        {state === "checking" ? (
          <div className="mt-10 flex justify-center">
            <Spinner className="size-6" />
          </div>
        ) : state === "invalid" ? (
          <>
            <span className="mt-10 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-900/30">
              <TriangleAlert className="size-7" strokeWidth={1.75} />
            </span>
            <h1 className="display mt-6 text-[44px] leading-[0.9] text-slate-900 dark:text-white">
              {t(<>Lien <em className="text-brand-500">expiré.</em></>, <>Link <em className="text-brand-500">expired.</em></>)}
            </h1>
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
              {t(
                "Ce lien a expiré ou a déjà servi. Pour votre sécurité, chaque lien n'est valable qu'une heure et une seule fois.",
                "This link has expired or was already used. For your security, each link only works once, within an hour.",
              )}
            </p>
            <Button size="lg" className="mt-8 w-full" onClick={() => navigate("/mot-de-passe-oublie")}>
              {t("Recevoir un nouveau lien", "Get a new link")}
              <ArrowRight className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <h1 className="display mt-10 text-[44px] leading-[0.9] text-slate-900 dark:text-white">
              {t(<>Nouveau <em className="text-brand-500">mot de passe.</em></>, <>New <em className="text-brand-500">password.</em></>)}
            </h1>
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
              {t("Pour le compte ", "For the account ")}
              <strong className="font-medium text-slate-900 dark:text-white">{email}</strong>.{" "}
              {t("Vous serez déconnecté de vos autres appareils.", "You'll be signed out of your other devices.")}
            </p>
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <input type="email" value={email} autoComplete="username" readOnly hidden />
              <Field label={t("Nouveau mot de passe", "New password")} htmlFor="password" hint={t("8 caractères minimum.", "At least 8 characters.")}>
                <div className="relative">
                  <Input
                    id="password"
                    type={show ? "text" : "password"}
                    required
                    minLength={8}
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-12 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-900 dark:hover:text-white"
                    aria-label={show ? t("Masquer le mot de passe", "Hide password") : t("Afficher le mot de passe", "Show password")}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <Field label={t("Confirmez le mot de passe", "Confirm password")} htmlFor="confirm">
                <Input
                  id="confirm"
                  type={show ? "text" : "password"}
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="h-12"
                />
              </Field>
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button type="submit" size="lg" className="group w-full" loading={loading}>
                {t("Enregistrer et me connecter", "Save and log in")}
                {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
}
