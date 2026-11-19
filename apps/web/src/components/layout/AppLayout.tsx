import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { LogOut, Menu, Moon, ShieldCheck, Sun, X, type LucideIcon } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { cx, formatNumber } from "../../lib/format";
import { PingsellLogo } from "../brand/PingsellLogo";
import { NavIcon, type NavIconName } from "../brand/NavIcons";
import { LanguageToggle } from "./LanguageToggle";
import { t, LOCALE } from "../../lib/i18n";
import { useAdminAccess } from "../../lib/useAdminAccess";
import { pushSetupDone, usePushSetup } from "../../lib/usePushSetup";

interface NavItem {
  to: string;
  label: string;
  icon: NavIconName | LucideIcon;
  end?: boolean;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: t("Pilotage", "Overview"),
    items: [
      { to: "/", label: t("Tableau de bord", "Dashboard"), icon: "dashboard", end: true },
      { to: "/statistiques", label: t("Statistiques", "Analytics"), icon: "stats" },
    ],
  },
  {
    section: "Messages",
    items: [
      { to: "/campagnes", label: t("Campagnes", "Campaigns"), icon: "campaigns" },
      { to: "/automatisations", label: t("Automatisations", "Automations"), icon: "automations" },
      { to: "/notifications", label: t("Notifications push", "Push notifications"), icon: "push" },
      { to: "/boite-envoi", label: t("Boîte d'envoi", "Outbox"), icon: "outbox" },
    ],
  },
  {
    section: "Audience",
    items: [
      { to: "/contacts", label: "Contacts", icon: "contacts" },
      { to: "/segments", label: "Segments", icon: "segments" },
    ],
  },
  {
    section: t("Réglages", "Settings"),
    items: [
      { to: "/integrations", label: t("Intégrations", "Integrations"), icon: "integrations" },
      { to: "/profil", label: t("Profil & équipe", "Profile & team"), icon: "team" },
      { to: "/parametres", label: t("Paramètres", "Settings"), icon: "settings" },
    ],
  },
];

/** Platform owner only (shown when /admin/access says so). */
const ADMIN_GROUP: { section: string; items: NavItem[] } = {
  section: t("Plateforme", "Platform"),
  items: [{ to: "/admin", label: t("Administration", "Administration"), icon: ShieldCheck }],
};

/** Pingsell lockup. `tone="light"` is for navy surfaces (sidebar); `auto` follows the theme. */
export function Logo({ className, tone = "auto" }: { className?: string; tone?: "auto" | "light" }) {
  return <PingsellLogo tone={tone} className={cx("h-8 w-auto", className)} />;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { account, user, usage, logout } = useAuth();
  const admin = useAdminAccess();
  const groups = admin ? [...NAV, ADMIN_GROUP] : NAV;
  const push = usePushSetup();
  const pushTodo = !!push && !pushSetupDone(push);
  // Visual quota: a soft monthly reference so the bar means something at a glance.
  const quota = 10000;
  const pct = usage ? Math.min(100, (usage.emails_sent_month / quota) * 100) : 0;

  return (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <div className="flex h-20 items-center px-6">
        <Logo tone="light" />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 pt-2 pb-6">
        {groups.map((group, gi) => (
          <div key={group.section}>
            <p className="mb-2 px-4 font-display text-[10.5px] font-semibold tracking-[0.2em] text-white/40 uppercase">
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
                        "group relative flex items-center gap-3 rounded-full px-4 py-2 font-display text-[14.5px] font-medium transition-colors duration-300",
                        isActive
                          ? "bg-brand-500 text-white [&_.ping-dot]:text-white"
                          : "text-white/60 hover:bg-white/[0.06] hover:text-white [&_.ping-dot]:text-white/35 hover:[&_.ping-dot]:text-[#f8603a]",
                      )
                    }
                  >
                    {typeof item.icon === "string" ? (
                      <NavIcon
                        name={item.icon}
                        className="size-[19px] shrink-0 [&_.ping-dot]:origin-[19px_5px] [&_.ping-dot]:transition-all [&_.ping-dot]:duration-300 group-hover:[&_.ping-dot]:scale-125"
                      />
                    ) : (
                      <item.icon className="size-[19px] shrink-0" strokeWidth={1.75} />
                    )}
                    {item.to === "/notifications" && pushTodo ? (
                      <span className="min-w-0 leading-tight" title={t("Les notifications push ne sont pas encore prêtes : ouvrez la page pour voir ce qui manque.", "Push notifications aren't ready yet: open the page to see what's missing.")}>
                        <span className="block truncate">{item.label}</span>
                        <span className="mt-0.5 flex items-center gap-1 font-sans text-[11px] font-semibold text-amber-300 group-aria-[current=page]:text-white">
                          <span className="size-1.5 rounded-full bg-amber-300 group-aria-[current=page]:bg-white" aria-hidden="true" />
                          {t("À configurer", "Needs setup")}
                        </span>
                      </span>
                    ) : (
                      item.label
                    )}
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
            <p className="font-display text-[10.5px] font-semibold tracking-[0.2em] text-white/50 uppercase">{t("Ce mois", "This month")}</p>
            <p className="text-[11px] text-white/50">{formatNumber(usage.contacts)} {t("contacts", usage.contacts === 1 ? "contact" : "contacts")}</p>
          </div>
          <p className="mt-3 font-display text-[38px] leading-none font-extrabold tracking-[-0.03em] text-white tabular-nums">
            {formatNumber(usage.emails_sent_month)}
            <span className="ml-1.5 font-sans text-xs font-medium tracking-normal text-white/50">{t("emails", usage.emails_sent_month === 1 ? "email" : "emails")}</span>
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <p className="mt-2.5 text-[11px] text-white/50">{t("Facturé au volume d'emails", "Billed by email volume")}</p>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-white/10 py-3 pr-3 pl-3">
        <Link to="/profil" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-full p-2 transition hover:bg-white/[0.06]" title={t("Profil & équipe", "Profile & team")}>
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
          title={t("Se déconnecter", "Sign out")}
          aria-label={t("Se déconnecter", "Sign out")}
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
      aria-label={theme === "dark" ? t("Passer en mode clair", "Switch to light mode") : t("Passer en mode sombre", "Switch to dark mode")}
      title={theme === "dark" ? t("Mode clair", "Light mode") : t("Mode sombre", "Dark mode")}
    >
      {theme === "dark" ? <Sun className="size-4" strokeWidth={1.5} /> : <Moon className="size-4" strokeWidth={1.5} />}
    </button>
  );
}

function Today() {
  const label = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
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
              aria-label={t("Fermer le menu", "Close menu")}
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
            aria-label={t("Ouvrir le menu", "Open menu")}
          >
            <Menu className="size-5" />
          </button>
          <Logo className="lg:hidden" />
          <Today />
          <div className="flex-1" />
          <span className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 font-display text-[11px] font-semibold tracking-wider text-slate-900 uppercase md:flex dark:bg-white/5 dark:text-slate-200">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> {t("Envois actifs", "Sending live")}
          </span>
          <LanguageToggle />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 pt-6 pb-16 sm:px-8 sm:pt-10 lg:px-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
