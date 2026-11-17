import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
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
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="relative flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 animate-rise flex-col justify-center py-12">
          <p className="eyebrow">{isLogin ? "Connexion" : "Inscription"}</p>
          <h1 className="display mt-4 text-[46px] leading-[0.9] text-slate-900 dark:text-white">
            {isLogin ? (
              <>
                Bon retour <em className="text-brand-500">parmi nous.</em>
              </>
            ) : (
              <>
                Votre première <em className="text-brand-500">missive.</em>
              </>
            )}
          </h1>
          <p className="mt-5 text-[15px] text-slate-600 dark:text-slate-400">
            {isLogin ? "Connectez-vous pour reprendre vos campagnes." : "Lancez votre première campagne en quelques minutes."}
          </p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            {!isLogin && (
              <Field label="Nom de la boutique ou de l'entreprise" htmlFor="name">
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ma Boutique" autoComplete="organization" />
              </Field>
            )}
            <Field label="Adresse email" htmlFor="email">
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" autoComplete="email" className="h-12" />
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
                className="h-12"
              />
            </Field>
            {error && <p className="rounded-xl border border-red-300 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:text-red-300">{error}</p>}
            <Button type="submit" size="lg" className="group w-full" loading={loading}>
              {isLogin ? "Se connecter" : "Créer mon compte"}
              {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
            </Button>
          </form>

          <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
            {isLogin ? "Pas encore de compte ?" : "Déjà inscrit ?"}{" "}
            <Link
              to={isLogin ? "/inscription" : "/connexion"}
              className="font-medium text-slate-950 underline decoration-brand-500 decoration-2 underline-offset-4 hover:text-brand-600 dark:text-white"
            >
              {isLogin ? "Créer un compte" : "Se connecter"}
            </Link>
          </p>
          {isLogin && import.meta.env.DEV && (
            <p className="mt-10 font-display text-[11px] text-slate-400">
              démo — demo@missive.local / demo1234
            </p>
          )}
        </div>
        <p className="font-display text-[10px] tracking-[0.2em] text-slate-400 uppercase">© Missive — Email marketing</p>
      </div>

      <div className="relative m-3 hidden overflow-hidden rounded-[28px] bg-brand-500 text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        {/* Concentric rings */}
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full border-[70px] border-white/10" />
        <div className="pointer-events-none absolute -top-10 -right-10 size-[260px] rounded-full bg-slate-900" />

        <div className="relative flex items-center justify-between font-display text-[11px] font-semibold tracking-[0.2em] text-white/70 uppercase">
          <span>Email marketing</span>
          <span className="mr-[220px]">{new Date().getFullYear()}</span>
        </div>

        <div className="relative">
          <h2 className="display max-w-[560px] text-[76px] leading-[0.86] text-white xl:text-[100px]">
            Des emails
            <br />
            qui <em className="text-slate-900">vendent.</em>
          </h2>
          <p className="mt-6 max-w-sm text-[17px] text-white/80">
            Sans y passer vos soirées. Écrivez, ciblez, envoyez — Missive s'occupe du reste.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-6 border-t border-white/25 pt-6">
          {[
            { n: "01", t: "Modèles prêts à l'emploi" },
            { n: "02", t: "Shopify & paniers abandonnés" },
            { n: "03", t: "Payé au volume, sans surprise" },
          ].map((f) => (
            <div key={f.n}>
              <p className="font-display text-[11px] font-bold text-slate-900">{f.n} —</p>
              <p className="mt-2 font-display text-[15px] leading-snug font-semibold text-white uppercase">{f.t}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
