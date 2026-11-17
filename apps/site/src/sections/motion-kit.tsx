import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

/** True on devices with a real hovering pointer (mouse / trackpad), false on touch. */
export function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(hover: hover) and (pointer: fine)");
    const on = () => setFine(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return fine;
}

/** A link that leans toward the cursor; its label follows a little further. */
export function MagneticLink({ href, enabled, className = "", children }: { href: string; enabled: boolean; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.5 });
  const lx = useTransform(sx, (v) => v * 0.45);
  const ly = useTransform(sy, (v) => v * 0.45);

  const move = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.32);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.45);
  };
  const leave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.a ref={ref} href={href} onPointerMove={move} onPointerLeave={leave} style={{ x: sx, y: sy }} className={className}>
      <motion.span style={{ x: lx, y: ly }} className="relative z-10 inline-flex items-center gap-2">
        {children}
      </motion.span>
    </motion.a>
  );
}
