import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cx } from "../lib/format";
import { Segmented } from "./ui/primitives";
import { countdownParts, type CountdownUnit } from "./email-builder/model";

const SAMPLE = {
  first_name: "Camille",
  last_name: "Martin",
  email: "camille.martin@exemple.fr",
  unsubscribe_url: "#",
};

/** Replace merge tags (optionally with a fallback: {{first_name|ami}}) with sample values for previewing. */
export function renderMergeTags(html: string): string {
  return html
    .replace(/\{\{\s*countdown_(days|hours|minutes|seconds)\s*\|([^}]*)\}\}/g, (_, unit: CountdownUnit, iso: string) => countdownParts(iso.trim(), Date.now())[unit])
    .replace(
    /\{\{\s*(first_name|last_name|email|unsubscribe_url)\s*(?:\|[^}]*)?\}\}/g,
    (_, key: keyof typeof SAMPLE) => SAMPLE[key],
  );
}

export function EmailPreview({
  html,
  subject,
  preheader,
  fromName,
  height = 640,
  showDeviceToggle = true,
  className,
}: {
  html: string;
  subject?: string;
  preheader?: string | null;
  fromName?: string | null;
  height?: number;
  showDeviceToggle?: boolean;
  className?: string;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const doc = useMemo(() => {
    const body = renderMergeTags(html || "");
    // Open links in a new tab instead of navigating the preview frame.
    if (/<base\b/i.test(body)) return body;
    const base = '<base target="_blank">';
    return /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + base) : base + body;
  }, [html]);

  return (
    <div className={cx("flex flex-col", className)}>
      {(subject !== undefined || showDeviceToggle) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            {subject !== undefined && (
              <>
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{renderMergeTags(subject) || "(Sans objet)"}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {fromName ? <span className="font-medium text-slate-600 dark:text-slate-300">{fromName}</span> : null}
                  {fromName && preheader ? " · " : ""}
                  {preheader ? renderMergeTags(preheader) : null}
                </p>
              </>
            )}
          </div>
          {showDeviceToggle && (
            <Segmented
              value={device}
              onChange={setDevice}
              options={[
                { value: "desktop", label: "Ordinateur", icon: Monitor },
                { value: "mobile", label: "Mobile", icon: Smartphone },
              ]}
            />
          )}
        </div>
      )}
      <div className="flex justify-center overflow-hidden rounded-b-xl bg-slate-100 p-4 dark:bg-slate-950/60">
        <div
          className={cx(
            "overflow-hidden bg-white shadow-sm ring-1 ring-slate-200 transition-all duration-300 dark:ring-slate-700",
            device === "mobile" ? "w-[375px] max-w-full rounded-[28px] border-[10px] border-slate-800" : "w-full rounded-lg",
          )}
        >
          {html ? (
            <iframe title="Aperçu de l'email" srcDoc={doc} sandbox="allow-popups allow-popups-to-escape-sandbox" className="block w-full bg-white" style={{ height }} />
          ) : (
            <div className="flex items-center justify-center text-sm text-slate-400" style={{ height: Math.min(height, 320) }}>
              Le contenu de l'email apparaîtra ici.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
