"use client";

import { useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { Copy, Check } from "lucide-react";

/* ---------- Copy button ---------- */
export function CopyButton({
  text,
  label = "复制",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <Btn onClick={copy} variant="soft" className={className}>
      {done ? <Check size={15} /> : <Copy size={15} />}
      {done ? "已复制" : label}
    </Btn>
  );
}

/* ---------- Button ---------- */
type Variant = "primary" | "soft" | "ghost" | "dark";

export function Btn({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  const styles: Record<Variant, string> = {
    primary:
      "bg-accent text-white hover:bg-accent/90 shadow-[2px_2px_0_0_rgba(21,24,30,0.9)]",
    dark: "bg-ink text-paper hover:bg-ink-2",
    soft: "bg-paper-2 text-ink hover:bg-ink/10 border border-ink/10",
    ghost: "text-ink/70 hover:bg-ink/5",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- Panel ---------- */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-ink/10 bg-card p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------- Label ---------- */
export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-ink/50">
      {children}
    </span>
  );
}

/* ---------- shared textarea class ---------- */
export const areaCls =
  "w-full resize-y rounded-lg border border-ink/15 bg-paper/60 p-3.5 font-mono text-sm leading-relaxed text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 scroll-thin";
