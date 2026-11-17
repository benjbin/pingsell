import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  BarChart3,
  Filter,
  Inbox,
  LogOut,
  Mail,
  Menu,
  Moon,
  Plug,
  Send,
  Settings,
  Sun,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { cx, formatNumber } from "../../lib/format";
import { Avatar } from "../ui/primitives";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: Array<{ section?: string; items: NavItem[] }> = [
  {
    items: [
      { to: "/", label: "Tableau de bord", icon: BarChart3, end: true },
      { to: "/campagnes", label: "Campagnes", icon: Send },
      { to: "/automatisations", label: "Automatisations", icon: Workflow },
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/segments", label: "Segments", icon: Filter },
    ],
  },
  {
    section: "Configuration",
    items: [
      { to: "/integrations", label: "Intégrations", icon: Plug },
      { to: "/boite-envoi", label: "Boîte d'envoi", icon: Inbox },
      { to: "/parametres", label: "Paramètres", icon: Settings },
    ],
  },
];

export function Logo({ className }: { className?: string; tone?: "auto" | "light" }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm shadow-brand-500/30">
        <Mail className="size-4" />
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white">Missive</span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { account, usage, logout } = useAuth();
  const quota = 10000;
  const pct = usage ? Math.min(100, (usage.emails_sent_month / quota) * 100) : 0;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {NAV.map((group, i) => (
          <div key={i}>
            {group.section && <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{group.section}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className={cx(
                            "size-[18px]",
                            isActive ? "text-brand-500 dark:text-brand-300" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300",
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
        <div className="mx-3 mb-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">Emails ce mois</span>
            <span className="text-slate-500 tabular-nums dark:text-slate-400">
              {formatNumber(usage.emails_sent_month)} / {formatNumber(quota)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{formatNumber(usage.contacts)} contacts · facturé au volume</p>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <Avatar text={(account?.name ?? "M").slice(0, 2).toUpperCase()} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{account?.name}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{account?.email}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="Se déconnecter"
          aria-label="Se déconnecter"
        >
          <LogOut className="size-4" />
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
        "flex size-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
        className,
      )}
      aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      title={theme === "dark" ? "Mode clair" : "Mode sombre"}
    >
      {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 lg:block dark:border-slate-800">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in-left shadow-2xl">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute top-4 right-3 z-10 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Fermer le menu"
            >
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-slate-900/80">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo className="lg:hidden" />
          <div className="flex-1" />
          <span className="hidden items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 md:flex dark:bg-emerald-900/30 dark:text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Envois actifs
          </span>
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
