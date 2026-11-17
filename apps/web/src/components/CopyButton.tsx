import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/primitives";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copier", size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size={size}
      icon={copied ? Check : Copy}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? "Copié" : label}
    </Button>
  );
}
