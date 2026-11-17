import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/api";
import { Button, Field, Input } from "../components/ui/primitives";
import { Logo, ThemeToggle } from "../components/layout/AppLayout";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === "login";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isLogin) await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/connexion" ? from : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2 dark:bg-slate-950">
      <div className="relative flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {isLogin ? "Connexion à votre compte" : "Créez votre compte"}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {isLogin ? "Content de vous revoir ! Connectez-vous pour gérer vos campagnes." : "Gratuit pour démarrer. Aucune carte bancaire requise."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {!isLogin && (
              <Field label="Nom de la boutique ou de l'entreprise" htmlFor="name">
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ma Boutique" autoComplete="organization" />
              </Field>
            )}
            <Field label="Adresse email" htmlFor="email">
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" autoComplete="email" />
            </Field>
            <Field label="Mot de passe" htmlFor="password" hint={!isLogin ? "8 caractères minimum." : undefined}>
              <Input
                id="password"
                type="password"
                required
                minLength={isLogin ? undefined : 8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
            </Field>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {isLogin ? "Se connecter" : "Créer mon compte"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {isLogin ? "Pas encore de compte ?" : "Déjà inscrit ?"}{" "}
            <Link to={isLogin ? "/inscription" : "/connexion"} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
              {isLogin ? "Créer un compte" : "Se connecter"}
            </Link>
          </p>
          {isLogin && import.meta.env.DEV && (
            <p className="mt-8 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Démo : <code>demo@missive.local</code> / <code>demo1234</code>
            </p>
          )}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="relative max-w-lg text-white">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Plateforme d'email marketing
          </span>
          <h2 className="mt-6 text-4xl leading-tight font-semibold tracking-tight">Des emails qui vendent, sans y passer vos soirées.</h2>
          <p className="mt-4 text-base text-brand-100">Créez, ciblez et automatisez vos campagnes. Payez uniquement les emails envoyés.</p>

          {/* Product preview card */}
          <div className="mt-10 rounded-2xl bg-white p-5 text-slate-900 shadow-2xl shadow-brand-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Soldes d'automne -20 %</p>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Envoyée</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { l: "Envois", v: "2 480" },
                { l: "Ouverture", v: "42,5 %" },
                { l: "Clics", v: "17,5 %" },
              ].map((k) => (
                <div key={k.l} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{k.l}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{k.v}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-16 items-end gap-1.5">
              {[30, 45, 38, 60, 52, 75, 68, 90, 72, 84, 64, 96].map((h, i) => (
                <span key={i} className="flex-1 rounded-t bg-brand-500/80" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-brand-200">Exemple de rapport de campagne</p>
        </div>
      </div>
    </div>
  );
}
