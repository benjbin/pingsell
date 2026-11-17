import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
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
      { to: "/notifications", label: "Notifications push" },
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
      { to: "/profil", label: "Profil & équipe" },
      { to: "/parametres", label: "Paramètres" },
    ],
  },
];

/** Geometric cube mark: blue top facet, white + soft-blue sides. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("size-8", className)} aria-hidden>
      <path d="M16 3 28 10 16 17 4 10Z" fill="#145CFF" />
      <path d="M4 10 16 17V30L4 23Z" fill="currentColor" />
      <path d="M28 10 16 17V30L28 23Z" fill="#4D82FF" />
    </svg>
  );
}

/** Wordmark. `tone` controls the text colour. */
export function Logo({ className, tone = "auto" }: { className?: string; tone?: "auto" | "light" }) {
  const color = tone === "light" ? "text-white" : "text-slate-900 dark:text-white";
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <LogoMark className={color} />
      <span className={cx("font-display text-[21px] leading-none font-extrabold tracking-[-0.03em] uppercase", color)}>
        Missive<span className="text-brand-500">.</span>
      </span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { account, user, usage, logout } = useAuth();
  // Visual quota: a soft monthly reference so the bar means something at a glance.
  const quota = 10000;
  const pct = usage ? Math.min(100, (usage.emails_sent_month / quota) * 100) : 0;

  return (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <div className="flex h-20 items-center px-6">
        <Logo tone="light" />
      </div>

      <nav className="flex-1 space-y-8 overflow-y-auto px-4 pt-4 pb-6">
        {NAV.map((group, gi) => (
          <div key={group.section}>
            <p className="mb-3 px-3 font-display text-[10.5px] font-semibold tracking-[0.2em] text-white/40 uppercase">
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
                        "group relative flex items-center rounded-full px-4 py-2.5 font-display text-[14.5px] font-medium transition-colors duration-300",
                        isActive ? "bg-brand-500 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {usage && (
        <div className="mx-4 mb-4 rounded-[20px] bg-white/[0.06] p-5 [@media(max-height:860px)]:hidden">
          <div className="flex items-baseline justify-between">
            <p className="font-display text-[10.5px] font-semibold tracking-[0.2em] text-white/50 uppercase">Ce mois</p>
            <p className="text-[11px] text-white/50">{formatNumber(usage.contacts)} contacts</p>
          </div>
          <p className="mt-3 font-display text-[38px] leading-none font-extrabold tracking-[-0.03em] text-white tabular-nums">
            {formatNumber(usage.emails_sent_month)}
            <span className="ml-1.5 font-sans text-xs font-medium tracking-normal text-white/50">emails</span>
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <p className="mt-2.5 text-[11px] text-white/50">Facturé au volume d'emails</p>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-white/10 py-3 pr-3 pl-3">
        <Link to="/profil" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-full p-2 transition hover:bg-white/[0.06]" title="Profil & équipe">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white font-display text-base font-extrabold text-slate-900">
            {(user?.name ?? account?.name ?? "M").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{user?.name ?? account?.name}</span>
            <span className="block truncate text-[11px] text-white/50">{user && user.name !== account?.name ? account?.name : (user?.email ?? account?.email)}</span>
          </span>
        </Link>
        <button
          onClick={logout}
          className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
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
        "flex size-10 items-center justify-center rounded-full text-slate-900 ring-1 ring-inset ring-slate-900/15 transition duration-300 hover:bg-slate-900 hover:text-white dark:text-white dark:ring-white/15 dark:hover:bg-white dark:hover:text-slate-900",
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
      {/* Desktop sidebar — deep navy in both themes */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
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
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-900/[0.06] bg-white/85 px-4 backdrop-blur-xl sm:px-8 lg:px-12 dark:border-white/[0.06] dark:bg-slate-950/85">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-full p-2 text-slate-900 hover:bg-slate-900/5 lg:hidden dark:text-slate-300 dark:hover:bg-white/5"
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo className="lg:hidden" />
          <Today />
          <div className="flex-1" />
          <span className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 font-display text-[11px] font-semibold tracking-wider text-slate-900 uppercase md:flex dark:bg-white/5 dark:text-slate-200">
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
