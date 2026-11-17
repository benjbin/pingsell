import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import type { GeneratedEmail } from "../lib/types";
import { Button, Field, Input, Select, Textarea } from "./ui/primitives";
import { useToast } from "./ui/Toast";
import { t } from "../lib/i18n";

const TONES = [
  { value: "chaleureux", label: t("Chaleureux", "Warm") },
  { value: "professionnel", label: t("Professionnel", "Professional") },
  { value: "enthousiaste", label: t("Enthousiaste", "Enthusiastic") },
  { value: "luxe", label: t("Haut de gamme", "Premium") },
  { value: "humoristique", label: t("Décalé", "Playful") },
];

const IDEAS = [
  t("Soldes d'hiver : -20 % sur toute la boutique ce week-end", "Winter sale: 20% off the entire store this weekend"),
  t("Bienvenue aux nouveaux abonnés avec un code de 10 %", "Welcome new subscribers with a 10% discount code"),
  t("Lancement de notre nouvelle collection printemps", "Launch of our new spring collection"),
  t("Relance panier abandonné avec livraison offerte", "Abandoned cart reminder with free shipping"),
];

export function AiGeneratePanel({
  onGenerated,
  defaultBrand,
  compact,
}: {
  onGenerated: (email: GeneratedEmail) => void;
  defaultBrand?: string;
  compact?: boolean;
}) {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("chaleureux");
  const [brand, setBrand] = useState(defaultBrand ?? "");
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!prompt.trim()) {
      toast.error(t("Décrivez l'email à générer", "Describe the email to generate"));
      return;
    }
    setLoading(true);
    try {
      const email = await api.ai.generateEmail({ prompt: prompt.trim(), tone, brand: brand.trim() || undefined });
      onGenerated(email);
      toast.success(t("Email généré", "Email generated"), t("Relisez et ajustez avant l'envoi.", "Review and tweak it before sending."));
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-brand-50/60 p-5 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:ring-brand-900">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm">
          <Sparkles className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("Partir d'un modèle", "Start from a template")}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("Objet, pré-en-tête et HTML responsive en quelques secondes.", "Subject line, preheader and responsive HTML in seconds.")}</p>
        </div>
      </div>
      <div className="space-y-3">
        <Textarea
          rows={compact ? 2 : 3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("Ex : Annonce de nos soldes d'hiver, -20 % sur les pulls, ton complice, bouton vers la boutique.", "E.g. Announce our winter sale, 20% off sweaters, friendly tone, button to the store.")}
          aria-label={t("Décrivez votre email", "Describe your email")}
        />
        {!compact && (
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setPrompt(idea)}
                className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 transition hover:text-brand-700 hover:ring-brand-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
              >
                {idea}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Ton", "Tone")} htmlFor="ai-tone">
            <Select id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((tone) => (
                <option key={tone.value} value={tone.value}>
                  {tone.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Marque", "Brand")} htmlFor="ai-brand">
            <Input id="ai-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder={t("Nom de votre marque", "Your brand name")} />
          </Field>
        </div>
        <Button variant="accent" onClick={generate} loading={loading} icon={Wand2} className="w-full">
          {loading ? t("Rédaction en cours…", "Writing…") : t("Générer l'email", "Generate email")}
        </Button>
      </div>
    </div>
  );
}
