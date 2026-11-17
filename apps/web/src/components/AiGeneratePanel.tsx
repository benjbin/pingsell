import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import type { GeneratedEmail } from "../lib/types";
import { Button, Field, Input, Select, Textarea } from "./ui/primitives";
import { useToast } from "./ui/Toast";

const TONES = [
  { value: "chaleureux", label: "Chaleureux" },
  { value: "professionnel", label: "Professionnel" },
  { value: "enthousiaste", label: "Enthousiaste" },
  { value: "luxe", label: "Haut de gamme" },
  { value: "humoristique", label: "Décalé" },
];

const IDEAS = [
  "Soldes d'hiver : -20 % sur toute la boutique ce week-end",
  "Bienvenue aux nouveaux abonnés avec un code de 10 %",
  "Lancement de notre nouvelle collection printemps",
  "Relance panier abandonné avec livraison offerte",
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
      toast.error("Décrivez l'email à générer");
      return;
    }
    setLoading(true);
    try {
      const email = await api.ai.generateEmail({ prompt: prompt.trim(), tone, brand: brand.trim() || undefined });
      onGenerated(email);
      toast.success("Email généré", "Relisez et ajustez avant l'envoi.");
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
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Partir d'un modèle</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Objet, pré-en-tête et HTML responsive en quelques secondes.</p>
        </div>
      </div>
      <div className="space-y-3">
        <Textarea
          rows={compact ? 2 : 3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex : Annonce de nos soldes d'hiver, -20 % sur les pulls, ton complice, bouton vers la boutique."
          aria-label="Décrivez votre email"
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
          <Field label="Ton" htmlFor="ai-tone">
            <Select id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Marque" htmlFor="ai-brand">
            <Input id="ai-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Nom de votre marque" />
          </Field>
        </div>
        <Button variant="accent" onClick={generate} loading={loading} icon={Wand2} className="w-full">
          {loading ? "Rédaction en cours…" : "Générer l'email"}
        </Button>
      </div>
    </div>
  );
}
