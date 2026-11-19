// Pingsell navigation icons. One system, drawn on a 24 grid:
// - 1.75 stroke, round caps and joins, corner radii 2 / 3 (like the mark's rounded tag);
// - every icon carries the brand's « ping » dot top right (the notification dot of the logo),
//   cut out of the glyph with a 1.75 gap so it reads as a badge, never as a collision.
// The dot uses `currentColor` by default; the sidebar colours it on hover / active (class `ping-dot`).
import { useId, type ReactNode } from "react";

export type NavIconName =
  | "dashboard"
  | "stats"
  | "campaigns"
  | "automations"
  | "push"
  | "outbox"
  | "contacts"
  | "segments"
  | "integrations"
  | "team"
  | "settings";

const DOT = { cx: 19, cy: 5, r: 2.25 };

const GLYPHS: Record<NavIconName, ReactNode> = {
  // Three tiles; the ping takes the fourth place.
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="2" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="2" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="2" />
    </>
  ),
  // A rising line that ends on the ping: each message brings a sale.
  stats: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M4 16.5l5-5 3.5 3 5-5.5" />
    </>
  ),
  campaigns: (
    <>
      <rect x="2.75" y="5.5" width="18.5" height="13" rx="3" />
      <path d="M3.75 7.5 12 13.25 20.25 7.5" />
    </>
  ),
  // A trigger, a path, then the step it starts.
  automations: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <path d="M6 8.5V13a3 3 0 0 0 3 3h4.5" />
      <rect x="13.5" y="12.5" width="7" height="7" rx="2" />
    </>
  ),
  push: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M10.5 18.25h3" />
    </>
  ),
  outbox: (
    <>
      <path d="M3 13.5h4.5L9 16h6l1.5-2.5H21V18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
      <path d="M12 11V3.75M8.75 7 12 3.75 15.25 7" />
    </>
  ),
  contacts: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  // A funnel: a segment is the part of your audience you keep.
  segments: <path d="M3.5 5h17L14 12.5v6l-4 2v-8z" />,
  integrations: (
    <>
      <path d="M9 2.75V6.5M15 2.75V6.5" />
      <path d="M6 6.5h12V10a6 6 0 0 1-12 0z" />
      <path d="M12 16v5.25" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3 19.75a6 6 0 0 1 12 0" />
      <circle cx="16.25" cy="11" r="2.25" />
      <path d="M17 15.5a4.25 4.25 0 0 1 4.25 4.25" />
    </>
  ),
  settings: (
    <>
      <path d="M3.5 6H9M14 6h6.5" />
      <circle cx="11.5" cy="6" r="2.5" />
      <path d="M3.5 12H13M18 12h2.5" />
      <circle cx="15.5" cy="12" r="2.5" />
      <path d="M3.5 18H6M11 18h9.5" />
      <circle cx="8.5" cy="18" r="2.5" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const mask = `ps-ping-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r + 1.75} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[name]}
      </g>
      <circle className="ping-dot" cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill="currentColor" />
    </svg>
  );
}
