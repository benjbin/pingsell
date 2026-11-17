import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { cx, formatNumber } from "../../lib/format";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "Studio",
    items: [
      { to: "/", label: "Tableau de bord", end: true },
      { to: "/campagnes", label: "Campagnes" },
      { to: "/automatisations", label: "Automatisations" },
    ],
  },
  {
    section: "Audience",
    items: [
      { to: "/contacts", label: "Contacts" },
      { to: "/segments", label: "Segments" },
    ],
  },
  {
    section: "Réglages",
    items: [
      { to: "/integrations", label: "Intégrations" },
      { to: "/boite-envoi", label: "Boîte d'envoi" },
      { to: "/parametres", label: "Paramètres" },
    ],
  },
];

/** Wordmark: a vermilion seal + serif italic name. `tone` controls the text colour. */
export function Logo({ className, tone = "auto" }: { className?: string; tone?: "auto" | "light" }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <span className="relative flex size-8 items-center justify-center rounded-full bg-brand-500 font-display text-[22px] leading-none text-slate-950 italic">
        <span className="-mt-1">m</span>
      </span>
      <span
        className={cx(
          "display text-[26px] leading-none italic",
          tone === "light" ? "text-paper" : "text-slate-950 dark:text-paper",
        )}
      >
        Missive
      </span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { account, usage, logout } = useAuth();
  // Visual quota: a soft monthly reference so the bar means something at a glance.
  const quota = 10000;
  const pct = usage ? Math.min(100, (usage.emails_sent_month / quota) * 100) : 0;

  return (
    <div className="grain flex h-full flex-col bg-ink text-paper">
      <div className="flex h-20 items-center px-6">
        <Logo tone="light" />
      </div>

      <nav className="flex-1 space-y-8 overflow-y-auto px-4 pt-4 pb-6">
        {NAV.map((group, gi) => (
          <div key={group.section}>
            <p className="mb-3 px-3 font-mono text-[10px] tracking-[0.2em] text-white/35 uppercase">
              {String(gi + 1).padStart(2, "0")} — {group.section}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        "group relative flex items-center rounded-full px-3 py-2 text-[14px] transition-colors",
                        isActive ? "bg-white/[0.07] text-white" : "text-white/55 hover:text-white",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cx(
                            "mr-3 size-1.5 rounded-full transition-all duration-300",
                            isActive ? "bg-brand-500 shadow-[0_0_12px_2px_rgba(255,77,28,0.6)]" : "bg-white/20 group-hover:bg-white/60",
                          )}
                        />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {usage && (
        <div className="mx-4 mb-4 rounded-2xl border border-white/10 p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] tracking-[0.2em] text-white/40 uppercase">Ce mois</p>
            <p className="font-mono text-[10px] text-white/40">{formatNumber(usage.contacts)} contacts</p>
          </div>
          <p className="display mt-2 text-[40px] leading-none text-white tabular-nums">
            {formatNumber(usage.emails_sent_month)}
            <span className="ml-1.5 font-sans text-xs text-white/40 not-italic">emails</span>
          </p>
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <p className="mt-2 font-mono text-[10px] text-white/40">Facturé au volume d'emails</p>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-white/10 px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper font-display text-lg text-slate-950 italic">
          {(account?.name ?? "M").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{account?.name}</p>
          <p className="truncate font-mono text-[10.5px] text-white/40">{account?.email}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-full p-2 text-white/40 transition hover:bg-white/10 hover:text-white"
          title="Se déconnecter"
          aria-label="Se déconnecter"
        >
          <LogOut className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className={cx(
        "flex size-9 items-center justify-center rounded-full text-slate-600 ring-1 ring-inset ring-slate-950/10 transition hover:bg-slate-950 hover:text-paper dark:text-slate-300 dark:ring-white/10 dark:hover:bg-paper dark:hover:text-slate-950",
        className,
      )}
      aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      title={theme === "dark" ? "Mode clair" : "Mode sombre"}
    >
      {theme === "dark" ? <Sun className="size-4" strokeWidth={1.5} /> : <Moon className="size-4" strokeWidth={1.5} />}
    </button>
  );
}

function Today() {
  const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return <span className="eyebrow hidden sm:inline">{label}</span>;
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const { refresh } = useAuth();

  useEffect(() => {
    setDrawerOpen(false);
    // Keep the usage counters in the sidebar fresh as the user navigates.
    refresh().catch(() => undefined);
  }, [location.pathname, refresh]);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar — always ink, in both themes */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] animate-slide-in-left shadow-2xl">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute top-6 right-4 z-10 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Fermer le menu"
            >
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 bg-paper/80 px-4 backdrop-blur-xl sm:px-8 lg:px-12 dark:bg-ink/80">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-full p-2 text-slate-700 hover:bg-slate-950/5 lg:hidden dark:text-slate-300 dark:hover:bg-white/5"
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo className="lg:hidden" />
          <Today />
          <div className="flex-1" />
          <span className="hidden items-center gap-2 font-mono text-[10.5px] tracking-wider text-slate-500 uppercase md:flex dark:text-slate-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Envois actifs
          </span>
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 pt-6 pb-16 sm:px-8 sm:pt-10 lg:px-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
