"use client";

import type { ReactNode } from "react";

/* ---------- 数字输入框 ---------- */
export function NumField({
  label,
  value,
  onChange,
  suffix,
  prefix,
  step = "0.01",
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  prefix?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-semibold text-ink/60">
        {label}
        {hint && <span className="font-normal text-ink/35">{hint}</span>}
      </span>
      <span className="flex items-center overflow-hidden rounded-lg border border-ink/15 bg-paper/60 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        {prefix && (
          <span className="border-r border-ink/10 bg-paper-2 px-2.5 py-2 text-xs text-ink/50">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={Number.isNaN(value) ? "" : value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent px-3 py-2 text-sm text-ink focus:outline-none"
        />
        {suffix && (
          <span className="border-l border-ink/10 bg-paper-2 px-2.5 py-2 text-xs text-ink/50">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

/* ---------- 分段选择器 ---------- */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      {label && (
        <span className="mb-1.5 block text-xs font-semibold text-ink/60">
          {label}
        </span>
      )}
      <div className="inline-flex w-full rounded-lg border border-ink/15 bg-paper-2 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition-all ${
              value === o.value
                ? "bg-card text-ink shadow-sm"
                : "text-ink/50 hover:text-ink/80"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- 表单分区 ---------- */
export function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

/* ---------- 结果指标卡 ---------- */
export function MetricCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const tones: Record<string, string> = {
    default: "text-ink",
    good: "text-pine",
    bad: "text-red-600",
    warn: "text-[#e07b0c]",
  };
  return (
    <div className="rounded-xl border border-ink/10 bg-card p-4">
      <div className="text-xs font-semibold text-ink/50">{label}</div>
      <div className={`mt-1.5 font-display text-2xl ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
