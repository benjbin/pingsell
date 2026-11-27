import { useEffect, useState } from "react";
import { Eye, Languages } from "lucide-react";
import { api } from "../../lib/api";
import { LANG, t } from "../../lib/i18n";
import type { CampaignLanguages, CampaignTranslationPreview } from "../../lib/types";
import { Badge, Button, Field, Select } from "../../components/ui/primitives";
import { Modal } from "../../components/ui/Overlay";
import { EmailPreview } from "../../components/EmailPreview";
import { useToast } from "../../components/ui/Toast";

/** « de » → « allemand » (dans la langue de l'interface). */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([LANG], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** Langues proposées pour « langue de l'email » (les plus courantes en tête). */
const WRITTEN_IN = ["fr", "en", "de", "es", "it", "nl", "pt", "pl", "sv", "da", "nb", "fi", "cs", "ro", "el", "tr", "ja", "zh", "ko", "ar"];

/**
 * Réglage « Traduire automatiquement » d'une campagne : la langue d'écriture, les langues de vos contacts
 * qui seront traduites, et un aperçu traduit (la traduction faite pour l'aperçu sert ensuite à l'envoi).
 */
export function TranslateSettings({
  campaignId,
  enabled,
  language,
  disabled,
  onEnabledChange,
  onLanguageChange,
  ensureSaved,
}: {
  campaignId: string | null;
  enabled: boolean;
  language: string;
  disabled: boolean;
  onEnabledChange: (v: boolean) => void;
  onLanguageChange: (v: string) => void;
  /** Enregistre le brouillon (l'aperçu traduit la dernière version) ; renvoie son id. */
  ensureSaved: () => Promise<string | null>;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<CampaignLanguages | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignTranslationPreview | null>(null);

  useEffect(() => {
    if (!campaignId || !enabled) return;
    let cancelled = false;
    api.campaigns
      .languages(campaignId)
      .then((r) => !cancelled && setInfo(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaignId, enabled, language]);

  const value = language || info?.source || LANG;
  const targets = (info?.languages ?? []).filter((l) => !l.same_as_source);
  const supported = targets.filter((l) => l.supported);
  const unsupported = targets.filter((l) => !l.supported);

  async function openPreview(lang: string) {
    setPreviewing(lang);
    try {
      const id = await ensureSaved();
      if (!id) return;
      setPreview(await api.campaigns.translationPreview(id, lang));
    } catch (err) {
      toast.error(err);
    } finally {
      setPreviewing(null);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl p-4 ring-1 ring-slate-900/10 sm:col-span-2 dark:ring-white/10">
      <label className="flex cursor-pointer gap-3">
        <input type="checkbox" className="mt-1 size-4 accent-brand-500" checked={enabled} disabled={disabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
            <Languages className="size-4" /> {t("Traduire dans la langue de chaque client", "Translate into each customer's language")}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {t(
              "Chaque client reçoit l'email dans sa langue (connue grâce à Shopify, à l'import ou au formulaire). Les clients dont la langue est inconnue reçoivent la version d'origine.",
              "Each customer gets the email in their language (known from Shopify, the import or the form). Customers whose language is unknown get the original.",
            )}
          </span>
        </span>
      </label>

      {enabled && (
        <div className="space-y-3 pl-7">
          <Field label={t("Langue dans laquelle vous écrivez l'email", "Language you write the email in")} htmlFor="cp-language">
            <Select id="cp-language" value={value} disabled={disabled} onChange={(e) => onLanguageChange(e.target.value)}>
              {[...new Set([value, ...WRITTEN_IN])].filter(Boolean).map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </Select>
          </Field>

          {info && !info.translation_available && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t(
                "Le traducteur n'est pas encore disponible sur le serveur : l'envoi sera refusé tant que cette case est cochée.",
                "The translator isn't available on the server yet: sending is refused while this is ticked.",
              )}
            </p>
          )}

          {!campaignId ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("Enregistrez le brouillon pour voir les langues de vos clients.", "Save the draft to see your customers' languages.")}</p>
          ) : info && !targets.length ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t(
                "Aucun de vos contacts n'a encore une autre langue connue : tout le monde recevra la version d'origine.",
                "None of your contacts has another known language yet: everyone gets the original.",
              )}
            </p>
          ) : (
            supported.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("Traduit automatiquement en :", "Automatically translated into:")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {supported.map((l) => (
                    <Button key={l.lang} size="sm" variant="secondary" icon={Eye} loading={previewing === l.lang} onClick={() => openPreview(l.lang)}>
                      {languageName(l.lang)}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("Cliquez sur une langue pour voir l'email exactement comme vos clients le recevront.", "Click a language to see the email exactly as your customers will get it.")}
                </p>
              </div>
            )
          )}
          {unsupported.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("Non traduisibles (version d'origine) : ", "Can't be translated (original version): ")}
              {unsupported.map((l) => languageName(l.lang)).join(", ")}
            </p>
          )}
        </div>
      )}

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        size="lg"
        title={preview ? t(`Aperçu en ${languageName(preview.language)}`, `Preview in ${languageName(preview.language)}`) : ""}
        description={
          preview && preview.kept > 0
            ? t(
                `${preview.kept} passage(s) sur ${preview.total} gardé(s) dans la langue d'origine (mise en forme trop complexe à traduire sans risque).`,
                `${preview.kept} of ${preview.total} passage(s) kept in the original language (formatting too complex to translate safely).`,
              )
            : undefined
        }
      >
        {preview?.html && (
          <>
            <div className="mb-3">
              <Badge tone="brand">{t("Traduction automatique", "Automatic translation")}</Badge>
            </div>
            <EmailPreview html={preview.html} subject={preview.subject} preheader={preview.preheader ?? ""} height={640} />
          </>
        )}
      </Modal>
    </div>
  );
}
