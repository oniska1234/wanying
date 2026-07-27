"use client";

import { useState } from "react";
import { Coins, Check, AlertTriangle, Lock } from "lucide-react";
import type { ComparisonProject } from "@/lib/quote-types";
import { detectCurrencies } from "@/lib/quote-utils";

interface Props {
  project: ComparisonProject;
  onUpdateRate: (
    currency: string,
    patch: Partial<{ rate: number; confirmed: boolean; date: string; source: string }>
  ) => void;
  onBaseCurrencyChange: (baseCurrency: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 多币种汇率确认面板（P0-02）。
 * 原则：币种是一等字段；未确认汇率前，跨币种不得参与最低价 / 可比总价计算。
 * 系统会预填一个「建议汇率」，但 confirmed 始终为 false，必须由用户显式确认。
 */
export default function CurrencyPanel({
  project,
  onUpdateRate,
  onBaseCurrencyChange,
}: Props) {
  const base = (project.baseCurrency ?? "CNY").toUpperCase();
  const currencies = detectCurrencies(project.documents);
  const foreign = currencies.filter((c) => c !== base);
  const rates = project.exchangeRates ?? {};

  // 草稿输入（字符串，避免 number input 抖动）
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (foreign.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-card px-4 py-3 text-xs text-muted">
        <Coins size={15} className="text-pine" />
        全部报价均为 {base}，无需汇率折算。
      </div>
    );
  }

  const pending = foreign.filter((c) => {
    const r = rates[c];
    return !r || !r.confirmed || !(r.rate > 0);
  });

  return (
    <div className="rounded-xl border border-ink/10 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Coins size={16} className="text-[#3b5bdb]" />
          币种与汇率
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          基准币
          <select
            value={base}
            onChange={(e) => onBaseCurrencyChange(e.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs font-semibold text-ink focus:border-accent focus:outline-none"
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pending.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            <span className="font-bold">{pending.join("、")} 汇率待确认</span>
            ：未确认前，这些报价只显示原币金额，<span className="font-bold">不参与最低价与可比总价计算</span>
            。请输入汇率并点击「确认」。
          </p>
        </div>
      )}

      <div className="space-y-2">
        {foreign.map((c) => {
          const r = rates[c];
          const confirmed = !!r && r.confirmed && r.rate > 0;
          const draft = drafts[c] ?? (r && r.rate > 0 ? String(r.rate) : "");
          return (
            <div
              key={c}
              className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                confirmed ? "border-pine/30 bg-pine/5" : "border-gold/30 bg-gold/5"
              }`}
            >
              <span className="w-12 font-mono text-sm font-bold text-ink">{c}</span>
              <span className="text-xs text-muted">1 {c} =</span>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={draft}
                placeholder="0.0000"
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [c]: e.target.value }));
                  const rate = parseFloat(e.target.value);
                  onUpdateRate(c, { rate: Number.isFinite(rate) ? rate : 0 });
                }}
                className="w-24 rounded-md border border-ink/15 bg-paper px-2 py-1 text-right font-mono text-sm text-ink focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-muted">{base}</span>
              <input
                type="date"
                value={r?.date ?? today()}
                onChange={(e) => onUpdateRate(c, { date: e.target.value })}
                className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                title="汇率日期"
              />
              <input
                type="text"
                value={r?.source ?? ""}
                placeholder="来源（如：央行中间价）"
                onChange={(e) => onUpdateRate(c, { source: e.target.value })}
                className="min-w-[140px] flex-1 rounded-md border border-ink/15 bg-paper px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
              />
              {confirmed ? (
                <button
                  onClick={() => onUpdateRate(c, { confirmed: false })}
                  className="flex items-center gap-1 rounded-md bg-pine/10 px-2.5 py-1 text-xs font-semibold text-pine hover:bg-pine/20"
                  title="点击撤销确认"
                >
                  <Check size={13} /> 已确认
                </button>
              ) : (
                <button
                  onClick={() => onUpdateRate(c, { confirmed: true, date: r?.date ?? today() })}
                  disabled={!r || !(r.rate > 0)}
                  className="flex items-center gap-1 rounded-md bg-[#3b5bdb] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#3b5bdb]/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Lock size={12} /> 确认汇率
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
