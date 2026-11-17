import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Mail, ShoppingBag } from "lucide-react";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/api";
import { cx } from "../lib/format";
import { Button, Field, Input } from "../components/ui/primitives";
import { Logo, ThemeToggle } from "../components/layout/AppLayout";
import { PingsellMark } from "../components/brand/PingsellLogo";

/** Public marketing site, for the "back to site" link. */
const SITE_URL = (import.meta.env.VITE_SITE_URL ?? "http://localhost:5191").replace(/\/+$/, "");

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      navigate(mode === "register" ? "/bienvenue" : from && from !== "/connexion" ? from : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Form side */}
      <div className="relative flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between gap-4">
          <a href={SITE_URL} aria-label="Pingsell, retour au site">
            <Logo />
          </a>
          <div className="flex items-center gap-2">
            <a
              href={SITE_URL}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm text-slate-500 transition hover:text-slate-900 sm:inline-flex dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              Retour au site
            </a>
            <ThemeToggle />
          </div>
        </div>

        <div key={mode} className="mx-auto flex w-full max-w-[400px] flex-1 animate-rise flex-col justify-center py-12">
          {/* Mode switch */}
          <div className="grid grid-cols-2 rounded-full bg-slate-100 p-1 font-display text-sm font-semibold dark:bg-white/5" role="tablist">
            {(
              [
                ["/connexion", "Connexion", isLogin],
                ["/inscription", "Inscription", !isLogin],
              ] as const
            ).map(([to, label, active]) => (
              <Link
                key={to}
                to={to}
                state={location.state}
                role="tab"
                aria-selected={active}
                className={cx(
                  "rounded-full py-2.5 text-center transition-colors duration-300",
                  active
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
                )}
              >
                {label}
              </Link>
            ))}
          </div>

          <h1 className="display mt-10 text-[44px] leading-[0.9] text-slate-900 dark:text-white">
            {isLogin ? (
              <>
                Bon retour <em className="text-brand-500">parmi nous.</em>
              </>
            ) : (
              <>
                Votre premier <em className="text-brand-500">ping.</em>
              </>
            )}
          </h1>
          <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
            {isLogin
              ? "Vos campagnes, vos notifications et vos ventes vous attendent."
              : "Créez votre compte en une minute. Emails et notifications push dans un seul outil."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {!isLogin && (
              <Field label="Nom de la boutique" htmlFor="name">
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ma Boutique"
                  autoComplete="organization"
                  className="h-12"
                />
              </Field>
            )}
            <Field label="Adresse email" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                autoComplete="email"
                className="h-12"
              />
            </Field>
            <Field label="Mot de passe" htmlFor="password" hint={!isLogin ? "8 caractères minimum." : undefined}>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={isLogin ? undefined : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  className="h-12 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 transition hover:text-slate-900 dark:hover:text-white"
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            {error && (
              <p role="alert" className="rounded-xl border border-red-300 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="group w-full" loading={loading}>
              {isLogin ? "Se connecter" : "Créer mon compte"}
              {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
            </Button>
          </form>

          {!isLogin && (
            <ul className="mt-6 space-y-2 text-sm text-slate-600 dark:text-slate-400">
              {["5 000 emails offerts chaque mois", "Sans carte bancaire", "Branché sur votre site en deux minutes"].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <Check className="size-4 text-brand-500" strokeWidth={2.5} />
                  {t}
                </li>
              ))}
            </ul>
          )}

          {isLogin && import.meta.env.DEV && (
            <p className="mt-10 font-display text-[11px] text-slate-400">démo — demo@missive.local / demo1234</p>
          )}
        </div>

        <p className="font-display text-[10px] tracking-[0.2em] text-slate-400 uppercase">
          © {new Date().getFullYear()} Pingsell — Chaque notif, une vente.
        </p>
      </div>

      {/* Story side */}
      <StoryPanel />
    </div>
  );
}

/** Right-hand panel: what Pingsell does, told as a stream of pings that turn into sales. */
function StoryPanel() {
  return (
    <div className="relative m-3 hidden overflow-hidden rounded-[28px] bg-slate-900 text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
      {/* Ping echoes */}
      <div className="pointer-events-none absolute -top-48 -right-48 size-[560px] rounded-full border-[56px] border-brand-500/25" />
      <div className="pointer-events-none absolute -top-20 -right-20 size-[300px] rounded-full border-[40px] border-brand-500/40" />
      <div className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full bg-brand-500/20 blur-[110px]" />

      <div className="relative flex items-center gap-3 font-display text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
        <PingsellMark tone="light" className="size-6" />
        Email · Push · Automatisations
      </div>

      <div className="relative">
        <h2 className="display max-w-[560px] text-[72px] leading-[0.86] text-white xl:text-[96px]">
          Chaque notif,
          <br />
          <em className="text-brand-400">une vente.</em>
        </h2>
        <p className="mt-6 max-w-md text-[17px] text-white/70">
          Emails, notifications push et relances automatiques. Pingsell vous montre l'argent que rapporte chaque message.
        </p>

        {/* Notification stack */}
        <div className="mt-10 max-w-[420px] space-y-3">
          <Ping
            icon={<PingsellMark tone="light" className="size-5" />}
            title="Nouvelle vente : 89 €"
            text="grâce à la campagne « Soldes d'hiver »"
            time="maintenant"
            delay="200ms"
          />
          <Ping
            icon={<ShoppingBag className="size-4" strokeWidth={2} />}
            title="Panier relancé, commande passée"
            text="Léa M. · 42 € · notification push"
            time="il y a 4 min"
            delay="350ms"
            className="ml-8"
          />
          <Ping
            icon={<Mail className="size-4" strokeWidth={2} />}
            title="Série de bienvenue envoyée"
            text="18 abonnés · ouverture 61 %"
            time="il y a 12 min"
            delay="500ms"
            className="ml-16 opacity-70"
          />
        </div>
      </div>

      <div className="relative grid grid-cols-3 gap-6 border-t border-white/15 pt-6">
        {[
          { n: "01", t: "Email et push au même endroit" },
          { n: "02", t: "Votre site et ses paniers abandonnés" },
          { n: "03", t: "Le revenu de chaque message" },
        ].map((f) => (
          <div key={f.n}>
            <p className="font-display text-[11px] font-bold text-brand-400">{f.n} —</p>
            <p className="mt-2 font-display text-[14px] leading-snug font-semibold text-white uppercase">{f.t}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ping({
  icon,
  title,
  text,
  time,
  delay,
  className,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  time: string;
  delay: string;
  className?: string;
}) {
  return (
    <div
      className={cx("flex animate-rise items-center gap-3 rounded-2xl bg-white/[0.08] p-3.5 ring-1 ring-white/10 backdrop-blur", className)}
      style={{ animationDelay: delay }}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-950/60 text-brand-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="shrink-0 text-[11px] text-white/45">{time}</p>
        </div>
        <p className="truncate text-[13px] text-white/60">{text}</p>
      </div>
    </div>
  );
}
