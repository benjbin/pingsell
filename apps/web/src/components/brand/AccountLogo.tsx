import { useEffect, useState } from "react";
import { cx } from "../../lib/format";

const toneCache = new Map<string, "light" | "dark">();

/** Is the logo mostly light (drawn for dark backgrounds) or dark? Measured once per URL from its opaque pixels. */
function useLogoTone(url: string): "light" | "dark" {
  const [tone, setTone] = useState<"light" | "dark">(() => toneCache.get(url) ?? "dark");
  useEffect(() => {
    const known = toneCache.get(url);
    if (known) {
      setTone(known);
      return;
    }
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const px = ctx.getImageData(0, 0, size, size).data;
        let sum = 0;
        let weight = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3] / 255;
          if (a < 0.1) continue;
          sum += ((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255) * a;
          weight += a;
        }
        // A logo with no transparency is its own background: keep it on white.
        const transparent = weight < size * size * 0.9;
        const result = transparent && weight > 0 && sum / weight > 0.6 ? "light" : "dark";
        toneCache.set(url, result);
        if (alive) setTone(result);
      } catch {
        /* unreadable pixels: keep the default */
      }
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return tone;
}

/** The store's logo in a round (or square) badge whose background suits it (dark for a light logo, white otherwise). */
export function AccountLogo({ url, className, padding = "p-1.5", square }: { url: string; className?: string; padding?: string; square?: boolean }) {
  const tone = useLogoTone(url);
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center overflow-hidden",
        square ? "rounded-2xl" : "rounded-full",
        tone === "light" ? "bg-slate-800 ring-1 ring-white/15" : "bg-white",
        padding,
        className,
      )}
    >
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  );
}
