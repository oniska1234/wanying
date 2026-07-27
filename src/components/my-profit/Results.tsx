"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, Info } from "lucide-react";
import Decimal from "decimal.js";
import type { CalculationResult, ScenarioResult } from "@/lib/my-profit/types";
import { MetricCard } from "./fields";

const rm = (v: Decimal | null | undefined) =>
  v == null ? "—" : `RM ${v.toFixed(2)}`;
const pct = (v: Decimal | null | undefined) =>
  v == null ? "—" : `${v.mul(100).toFixed(2)}%`;

const riskStyle: Record<string, string> = {
  red: "border-red-300 bg-red-50 text-red-700",
  orange: "border-orange-300 bg-orange-50 text-orange-700",
  yellow: "border-yellow-300 bg-yellow-50 text-yellow-800",
};

export default function Results({
  result,
  scenarios,
  costCurrency,
}: {
  result: CalculationResult;
  scenarios: ScenarioResult[];
  costCurrency: string;
}) {
  const [showFees, setShowFees] = useState(true);

  const profitTone = result.netProfit.lt(0)
    ? "bad"
    : result.netMargin.lt(new Decimal("0.1"))
      ? "warn"
      : "good";

  return (
    <div className="space-y-4">
      {/* 核心指标 */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="单件净利润"
          value={rm(result.netProfit)}
          sub={`期望利润 ${rm(result.expectedProfit)}`}
          tone={profitTone}
        />
        <MetricCard
          label="净利率"
          value={pct(result.netMargin)}
          sub="净利润 / 总交易额"
          tone={profitTone}
        />
        <MetricCard
          label="保本售价"
          value={rm(result.breakEvenPrice)}
          sub="净利润 = 0 的最低售价"
        />
        <MetricCard
          label="最高采购价"
          value={
            result.maxPurchasePrice == null
              ? "—"
              : `${costCurrency === "MYR" ? "RM" : "¥"} ${result.maxPurchasePrice.toFixed(2)}`
          }
          sub={`成本币种 ${costCurrency}`}
        />
      </div>

      {/* 建议售价 */}
      {result.suggestedPrice && (
        <div className="rounded-xl border border-pine/30 bg-pine/5 p-4 text-sm">
          <span className="font-semibold text-pine">💡 目标 20% 净利率建议售价：</span>
          <span className="ml-2 font-display text-lg text-pine">
            {rm(result.suggestedPrice)}
          </span>
        </div>
      )}

      {/* 风险标记 */}
      {result.risks.length > 0 && (
        <div className="space-y-2">
          {result.risks.map((r, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${riskStyle[r.level]}`}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{r.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* 收入与成本概览 */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h3 className="mb-3 text-sm font-bold">收支概览</h3>
        <dl className="space-y-2 text-sm">
          <Row label="总交易额" value={rm(result.grossRevenue)} />
          <Row label="平台总费用" value={`- ${rm(result.totalPlatformFees)}`} negative />
          <Row label="预计到手收入" value={rm(result.netRevenue)} strong />
          <Row label="商品及履约成本" value={`- ${rm(result.totalCogs)}`} negative />
          <Row label="达人 + 广告" value={`- ${rm(result.totalAffiliateAd)}`} negative />
          <div className="my-2 border-t border-dashed border-ink/15" />
          <Row label="净利润" value={rm(result.netProfit)} strong />
        </dl>
      </div>

      {/* 费用明细 */}
      <div className="rounded-xl border border-ink/10 bg-card">
        <button
          onClick={() => setShowFees((v) => !v)}
          className="flex w-full items-center justify-between p-5 text-sm font-bold"
        >
          平台费用明细
          {showFees ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showFees && (
          <div className="space-y-3 px-5 pb-5">
            {result.feeBreakdown.map((f) => (
              <div key={f.feeType} className="rounded-lg bg-paper-2 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{f.label}</span>
                  <span className="font-mono font-semibold text-accent">
                    {rm(f.amount)}
                  </span>
                </div>
                {f.formula && (
                  <div className="mt-1 font-mono text-xs text-ink/55">{f.formula}</div>
                )}
                <div className="mt-1 flex items-center gap-1 text-xs text-ink/40">
                  <Info size={11} />
                  计费基数 {rm(f.base)}
                  {f.source && <span>· 来源：TikTok 官方费率</span>}
                  {f.version != null && <span>· v{f.version}</span>}
                </div>
              </div>
            ))}
            {result.feeBreakdown.length === 0 && (
              <p className="text-sm text-muted">无匹配费率，请手工输入。</p>
            )}
          </div>
        )}
      </div>

      {/* 情景分析 */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h3 className="mb-3 text-sm font-bold">情景分析</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50">
                <th className="pb-2 font-semibold">情景</th>
                <th className="pb-2 text-right font-semibold">净利润</th>
                <th className="pb-2 text-right font-semibold">净利率</th>
                <th className="pb-2 text-right font-semibold">期望利润</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.label} className="border-t border-ink/5">
                  <td className="py-2 font-semibold">{s.label}</td>
                  <td
                    className={`py-2 text-right font-mono ${s.netProfit.lt(0) ? "text-red-600" : "text-ink"}`}
                  >
                    {rm(s.netProfit)}
                  </td>
                  <td className="py-2 text-right font-mono">{pct(s.netMargin)}</td>
                  <td className="py-2 text-right font-mono">{rm(s.expectedProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 退款分析 */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h3 className="mb-3 text-sm font-bold">退款风险</h3>
        <dl className="space-y-2 text-sm">
          <Row label="单笔全额退款损失" value={rm(result.refundLoss)} negative />
          <Row
            label="退款调整后期望利润"
            value={rm(result.refundAdjustedProfit)}
            strong
          />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink/40">
          免责声明：本工具基于您输入的参数与参考费率进行估算，结果仅供选品决策参考，
          不构成任何经营建议。实际费用以 TikTok Shop 卖家中心结算为准。
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? "font-semibold text-ink" : "text-ink/60"}>{label}</dt>
      <dd
        className={`font-mono ${strong ? "font-bold text-ink" : negative ? "text-red-500" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
