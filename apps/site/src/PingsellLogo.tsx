// Pingsell brand mark and lockup (piste A V5, see brand/pingsell/a). Generated from the master SVGs.
// Colours follow the brand rules: ink = sale (navy/white), echo = ping (blue), dot = notification (coral).

type Tone = "auto" | "light" | "dark" | "mono";

const TONES: Record<Tone, { ink: string; echo: string; dot: string }> = {
  // Light surfaces, switching to the dark palette when the app is in dark mode.
  auto: {
    ink: "fill-[#0b214a] dark:fill-white",
    echo: "fill-[#145cff] dark:fill-[#4d82ff]",
    dot: "fill-[#e9542f] dark:fill-[#f8603a]",
  },
  // Always on a light surface.
  dark: { ink: "fill-[#0b214a]", echo: "fill-[#145cff]", dot: "fill-[#e9542f]" },
  // Always on navy / dark surfaces.
  light: { ink: "fill-white", echo: "fill-[#4d82ff]", dot: "fill-[#f8603a]" },
  // Single colour (currentColor), for watermarks and print.
  mono: { ink: "fill-current", echo: "fill-current", dot: "fill-current" },
};

/** Symbol only (price tag + notification dot + ping echo). */
export function PingsellMark({ className, tone = "auto", title }: { className?: string; tone?: Tone; title?: string }) {
  const c = TONES[tone];
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path className={c.ink} fillRule="evenodd" d="M52.257 17.743L52.257 33.257A6 6 0 0 1 50.5 37.5L31.5 56.5A6 6 0 0 1 23.015 56.5L7.5 40.985A6 6 0 0 1 7.5 32.5L26.5 13.5A6 6 0 0 1 30.743 11.743L46.257 11.743A6 6 0 0 1 52.257 17.743ZM26.257 27.743A10 10 0 1 0 46.257 27.743A10 10 0 1 0 26.257 27.743Z" />
      <path className={c.echo} d="M62.257 28.743L62.257 17.743A16 16 0 0 0 46.257 1.743L35.257 1.743L29.257 7.743L46.257 7.743A10 10 0 0 1 56.257 17.743L56.257 34.743Z" />
      <path className={c.dot} d="M30.257 27.743A6 6 0 1 1 42.257 27.743A6 6 0 1 1 30.257 27.743Z" />
    </svg>
  );
}

/** Horizontal lockup: symbol + "pingsell" wordmark. Minimum height 28 px; use PingsellMark below that. */
export function PingsellLogo({ className, tone = "auto" }: { className?: string; tone?: Tone }) {
  const c = TONES[tone];
  return (
    <svg viewBox="-2 -60 351.600 80" className={className} role="img" aria-label="Pingsell">
      <path className={c.ink} fillRule="evenodd" d="M46.091 -40.146L46.091 -24.772A5.945 5.945 0 0 1 44.35 -20.568L25.523 -1.741A5.945 5.945 0 0 1 17.115 -1.741L1.741 -17.115A5.945 5.945 0 0 1 1.741 -25.523L20.568 -44.35A5.945 5.945 0 0 1 24.772 -46.091L40.146 -46.091A5.945 5.945 0 0 1 46.091 -40.146ZM20.328 -30.237A9.909 9.909 0 1 0 40.146 -30.237A9.909 9.909 0 1 0 20.328 -30.237Z" />
      <path className={c.echo} d="M56 -29.246L56 -40.146A15.854 15.854 0 0 0 40.146 -56L29.246 -56L23.301 -50.055L40.146 -50.055A9.909 9.909 0 0 1 50.055 -40.146L50.055 -23.301Z" />
      <path className={c.dot} d="M24.291 -30.237A5.945 5.945 0 1 1 36.182 -30.237A5.945 5.945 0 1 1 24.291 -30.237Z" />
      <g transform="translate(68 0)"><path className={c.ink} fillRule="evenodd" d="M0 16L0 -40L10 -40C16.05 -40 14.95 -41 21 -41A21 21 0 1 1 10 -2.111L10 16ZM8 -20A11.8 11.8 0 0 0 31.6 -20A11.8 11.8 0 0 0 8 -20ZM49 0L49 -40L59 -40L59 0ZM68 0L68 -40L78 -40C82.95 -40 82.05 -41 87 -41A19 19 0 0 1 106 -22L106 0L96 0L96 -23A9 9 0 0 0 78 -23L78 0ZM155 -40L155 -1A21 18 0 0 1 114.968 6.607L123 2.238A11.4 8.8 0 0 0 145 -1L145 -2.111A21 21 0 1 1 134 -41C140.05 -41 138.95 -40 145 -40ZM123.4 -20A11.8 11.8 0 0 0 147 -20A11.8 11.8 0 0 0 123.4 -20ZM194.014 -33.483A16.2 12.925 0 1 0 179.3 -15.15A7 3.475 0 1 1 172.322 -11.948L163.415 -6.806A17.3 12.925 0 1 0 179.3 -24.85A5.9 3.475 0 1 1 185.199 -28.393ZM243.306 -16.5A21 21 0 1 0 240.787 -9.5L232.079 -14.527A10.7 11.8 0 0 1 212.382 -16.5ZM212.908 -25L232.292 -25A10.7 11.8 0 0 0 212.908 -25ZM250.6 0L250.6 -56L260.6 -56L260.6 0ZM269.6 0L269.6 -56L279.6 -56L279.6 0ZM48 -51.8A6 6 0 0 0 60 -51.8A6 6 0 0 0 48 -51.8Z" /></g>
    </svg>
  );
}
