import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowRight, ImagePlus, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { Button } from "./ui/primitives";
import { useToast } from "./ui/Toast";
import { uploadImage } from "./email-builder/media";
import { DEFAULT_THEME, parseBrandKit, type BrandKit } from "./email-builder/model";
import { t } from "../lib/i18n";

/** Height of the logo in email headers (px): readable on mobile without dominating. */
export const LOGO_HEIGHT = 44;

/** Saves the logo into the account's brand kit, keeping whatever else the kit already holds. */
async function saveLogo(logoUrl: string) {
  const kit = parseBrandKit(await api.brandKit.get());
  const next: BrandKit = { ...(kit ?? { theme: DEFAULT_THEME }), logoUrl, logoHeight: kit?.logoHeight ?? LOGO_HEIGHT };
  await api.brandKit.save(JSON.stringify(next));
}

/**
 * Onboarding step 1: the merchant's logo. It goes into the brand kit, so every new email
 * (campaigns, and the first automations created at the end of the onboarding) carries it.
 */
export function BrandLogoStep({ brand, onLogo, onNext }: { brand: string; onLogo: (url: string | null) => void; onNext: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  // Coming back to this step: show the logo already saved.
  useEffect(() => {
    api.brandKit
      .get()
      .then((raw) => {
        const url = parseBrandKit(raw)?.logoUrl ?? null;
        if (url) {
          setLogo(url);
          onLogo(url);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadImage(file);
      await saveLogo(asset.url);
      setLogo(asset.url);
      onLogo(asset.url);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files[0]);
  };

  return (
    <section className="animate-rise">
      <p className="eyebrow">{t("Bienvenue", "Welcome")}{brand ? `, ${brand}` : ""}</p>
      <h1 className="display mt-4 text-[40px] leading-[0.92] text-slate-900 sm:text-[60px] dark:text-white">
        {t(
          <>
            Commençons par <em className="text-brand-500">votre logo</em>
          </>,
          <>
            Let's start with <em className="text-brand-500">your logo</em>
          </>,
        )}
      </h1>
      <p className="mt-4 max-w-xl text-[17px] text-slate-600 dark:text-slate-300">
        {t(
          "Il apparaîtra en haut de chacun de vos emails. Vos clients reconnaissent votre marque au premier coup d'œil, et vos emails inspirent confiance.",
          "It will appear at the top of every email you send. Your customers recognise your brand at a glance, and your emails feel trustworthy.",
        )}
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          disabled={busy}
          className={cx(
            "flex min-h-64 flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed bg-white p-8 text-center transition dark:bg-slate-900",
            over ? "border-brand-500 bg-brand-50/50" : "border-slate-300 hover:border-brand-400 dark:border-slate-700",
          )}
        >
          {busy ? (
            <Loader2 className="size-8 animate-spin text-brand-500" />
          ) : logo ? (
            <>
              <img src={logo} alt={brand} className="max-h-24 max-w-[80%] object-contain" />
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500">
                <RefreshCw className="size-4" /> {t("Changer de logo", "Change logo")}
              </span>
            </>
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-900/30">
                <ImagePlus className="size-7" strokeWidth={1.75} />
              </span>
              <span className="font-display text-lg font-bold text-slate-900 dark:text-white">{t("Déposez votre logo ici", "Drop your logo here")}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">{t("ou cliquez pour le choisir · PNG, JPG ou WebP", "or click to choose it · PNG, JPG or WebP")}</span>
              <span className="text-xs text-slate-400">{t("Idéalement sur fond transparent, au moins 400 px de large", "Ideally on a transparent background, at least 400 px wide")}</span>
            </>
          )}
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void handle(e.target.files?.[0] ?? undefined)} />

        <div>
          <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{t("Aperçu dans un email", "Preview in an email")}</p>
          <div className="overflow-hidden rounded-[22px] bg-[#f4f2fb] p-5">
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="flex items-center justify-center border-b border-slate-100 px-6 py-6">
                {logo ? (
                  <img src={logo} alt={brand} style={{ height: LOGO_HEIGHT }} className="w-auto max-w-full object-contain" />
                ) : (
                  <span className="font-display text-xl font-bold text-slate-900">{brand || t("Votre marque", "Your brand")}</span>
                )}
              </div>
              <div className="space-y-2.5 px-6 py-6">
                <div className="h-4 w-1/2 rounded bg-slate-200" />
                <div className="h-3 w-full rounded bg-slate-100" />
                <div className="h-3 w-5/6 rounded bg-slate-100" />
                <div className="mt-4 h-9 w-36 rounded-full bg-slate-900" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onNext} className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
          {logo ? "" : t("Je n'ai pas encore de logo", "I don't have a logo yet")}
        </button>
        <Button size="lg" disabled={!logo || busy} onClick={onNext}>
          {t("Continuer", "Continue")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </section>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Replaces the placeholder header of the default email ("Votre marque") with the merchant's logo or name. */
export function brandEmailHeader(html: string, brand: string, logoUrl: string | null): string {
  const header = /<td style="background:#0E0E0C;padding:28px 32px;color:#ffffff;font-size:20px;font-weight:bold;">\s*(?:Votre marque|Your brand)\s*<\/td>/;
  const name = escapeHtml(brand || t("Votre marque", "Your brand"));
  const cell = logoUrl
    ? `<td align="center" style="background:#ffffff;padding:28px 32px;border-bottom:1px solid #eef0f4;"><img src="${escapeHtml(logoUrl)}" alt="${name}" height="${LOGO_HEIGHT}" style="display:inline-block;height:${LOGO_HEIGHT}px;width:auto;border:0;"></td>`
    : `<td style="background:#0E0E0C;padding:28px 32px;color:#ffffff;font-size:20px;font-weight:bold;">${name}</td>`;
  return html.replace(header, cell);
}
