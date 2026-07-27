"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Calculator, RotateCcw, RefreshCw, Bookmark } from "lucide-react";
import Decimal from "decimal.js";
import {
  DEFAULT_FORM,
  buildInput,
  type ProfitFormValues,
} from "@/lib/my-profit/defaults";
import { calculate } from "@/lib/my-profit/calculator";
import { calculateScenarios } from "@/lib/my-profit/scenarios";
import type { RawFeeRule } from "@/lib/my-profit/fee-engine";
import type {
  CalculationResult,
  ScenarioResult,
  ShopType,
  BxpStatus,
  CostCurrency,
} from "@/lib/my-profit/types";
import { NumField, Segmented, Section } from "./fields";
import Results from "./Results";

const CATEGORIES = [
  { value: "", label: "通用 / 默认费率" },
  { value: "Electronics", label: "Electronics（电子产品）" },
  { value: "Fashion", label: "Fashion（服饰）" },
  { value: "Home & Living", label: "Home & Living（家居）" },
  { value: "Beauty & Personal Care", label: "Beauty（美妆个护）" },
];

/** 递归将 Decimal 转为普通数值，便于 JSON 快照存储 */
function toPlain(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Decimal.isDecimal(v)) return v.toNumber();
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object)) o[k] = toPlain(val);
    return o;
  }
  return v;
}

export default function MyProfit() {
  const router = useRouter();
  const { status } = useSession();
  const [form, setForm] = useState<ProfitFormValues>(DEFAULT_FORM);
  const [computed, setComputed] = useState<{
    result: CalculationResult;
    scenarios: ScenarioResult[];
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [rules, setRules] = useState<RawFeeRule[] | null>(null);
  const [rateInfo, setRateInfo] = useState<{
    rate: number;
    isRealtime: boolean;
    fetchedAt: string;
  } | null>(null);

  // 加载数据库费率规则与实时汇率
  useEffect(() => {
    fetch("/api/my-profit/fee-rules?site=MY")
      .then((r) => r.json())
      .then((d) => {
        if (d?.rules?.length) setRules(d.rules as RawFeeRule[]);
      })
      .catch(() => setRules(null));

    fetch("/api/my-profit/exchange-rate?from=MYR&to=CNY")
      .then((r) => r.json())
      .then((d) => {
        if (d?.rate) {
          setRateInfo({ rate: d.rate, isRealtime: d.isRealtime, fetchedAt: d.fetchedAt });
          setForm((f) => ({ ...f, exchangeRate: Number(d.rate.toFixed(4)) }));
        }
      })
      .catch(() => {});
  }, []);

  const set = <K extends keyof ProfitFormValues>(key: K, value: ProfitFormValues[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const runCalc = () => {
    const input = buildInput(form, rules ?? undefined);
    const result = calculate(input);
    const scenarios = calculateScenarios(input);
    setComputed({ result, scenarios });
    setDirty(false);
  };

  const reset = () => {
    setForm(DEFAULT_FORM);
    setComputed(null);
    setDirty(false);
  };

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");

  const saveToList = async () => {
    if (!computed) return;
    if (status !== "authenticated") {
      router.push("/auth/login?callbackUrl=/tools/my-profit");
      return;
    }
    const name = window.prompt("为这个选品起个名字", form.category || "未命名商品");
    if (!name || !name.trim()) return;
    setSaveState("saving");
    setSaveMsg("");
    try {
      const result = computed.result;
      const res = await fetch("/api/my-profit/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category: form.category,
          shopType: form.shopType,
          bxpStatus: form.bxpStatus,
          sku: {
            form: toPlain(form),
            result: toPlain(result),
            feeRuleVersion: result.feeRuleVersions?.join(",") || null,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveState("error");
        setSaveMsg(data.error || "保存失败");
        return;
      }
      setSaveState("saved");
      setSaveMsg("已保存到选品清单");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setSaveMsg("网络错误，保存失败");
    }
  };

  const cur = form.costCurrency === "MYR" ? "RM" : "¥";

  // 实时费率匹配预览（用于提示是否有未匹配项）
  const feePreview = useMemo(
    () => buildInput(form, rules ?? undefined).feeRules,
    [form, rules]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ================= 输入区 ================= */}
      <div className="space-y-4">
        <Section title="店铺与类目" desc="决定平台费率匹配">
          <div className="space-y-4">
            <Segmented<ShopType>
              label="店铺类型"
              value={form.shopType}
              onChange={(v) => set("shopType", v)}
              options={[
                { value: "MARKETPLACE", label: "Marketplace" },
                { value: "MALL", label: "Mall" },
              ]}
            />
            <Segmented<BxpStatus>
              label="BXP 状态"
              value={form.bxpStatus}
              onChange={(v) => set("bxpStatus", v)}
              options={[
                { value: "NON_BXP", label: "非 BXP" },
                { value: "BXP", label: "BXP" },
                { value: "UNCERTAIN", label: "不确定" },
              ]}
            />
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink/60">
                商品类目
              </span>
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <Segmented<CostCurrency>
              label="成本币种"
              value={form.costCurrency}
              onChange={(v) => set("costCurrency", v)}
              options={[
                { value: "CNY", label: "人民币 ¥" },
                { value: "MYR", label: "马币 RM" },
              ]}
            />
            {feePreview.hasUnmatched && (
              <p className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-700">
                部分费率未匹配到规则，计算结果可能不完整，请核对费率输入。
              </p>
            )}
          </div>
        </Section>

        <Section title="收入项" desc="单位：马币 RM">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="商品原价" prefix="RM" value={form.originalPrice} onChange={(v) => set("originalPrice", v)} />
            <NumField label="卖家折扣" prefix="RM" value={form.sellerDiscount} onChange={(v) => set("sellerDiscount", v)} />
            <NumField label="平台折扣" prefix="RM" value={form.platformDiscount} onChange={(v) => set("platformDiscount", v)} />
            <NumField label="买家运费" prefix="RM" value={form.buyerShipping} onChange={(v) => set("buyerShipping", v)} />
            <NumField label="其他收入" prefix="RM" value={form.otherIncome} onChange={(v) => set("otherIncome", v)} />
            <NumField label="商品数量" suffix="件" step="1" value={form.quantity} onChange={(v) => set("quantity", v)} />
          </div>
        </Section>

        <Section title="成本项" desc={`单位：${cur}（自动按汇率换算为 RM）`}>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="单件采购价" prefix={cur} value={form.purchasePrice} onChange={(v) => set("purchasePrice", v)} />
            <NumField label="国内运输/操作" prefix={cur} value={form.domesticShipping} onChange={(v) => set("domesticShipping", v)} />
            <NumField label="包材费" prefix={cur} value={form.packagingCost} onChange={(v) => set("packagingCost", v)} />
            <NumField label="跨境头程" prefix={cur} value={form.crossBorderLogistics} onChange={(v) => set("crossBorderLogistics", v)} />
            <NumField label="本地履约/尾程" prefix={cur} value={form.localFulfillment} onChange={(v) => set("localFulfillment", v)} />
            <NumField label="仓储分摊" prefix={cur} value={form.storageCost} onChange={(v) => set("storageCost", v)} />
            <NumField label="其他成本" prefix={cur} value={form.otherCost} onChange={(v) => set("otherCost", v)} />
          </div>
        </Section>

        <Section title="达人与广告" desc="比例基于到手收入">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="达人佣金比例" suffix="%" value={form.affiliateRate} onChange={(v) => set("affiliateRate", v)} />
            <NumField label="达人佣金固定" prefix="RM" value={form.affiliateFixed} onChange={(v) => set("affiliateFixed", v)} />
            <NumField label="广告成本比例" suffix="%" value={form.adRate} onChange={(v) => set("adRate", v)} />
            <NumField label="广告固定成本" prefix="RM" value={form.adFixed} onChange={(v) => set("adFixed", v)} />
          </div>
        </Section>

        <Section title="退款与汇率">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="预估退款率" suffix="%" value={form.refundRate} onChange={(v) => set("refundRate", v)} />
            <NumField label="退款可回收价值" prefix={cur} value={form.refundRecovery} onChange={(v) => set("refundRecovery", v)} />
            <NumField label="退款额外成本" prefix={cur} value={form.refundExtraCost} onChange={(v) => set("refundExtraCost", v)} />
            <NumField label="汇率 (1 RM = ? CNY)" suffix="CNY" step="0.0001" value={form.exchangeRate} onChange={(v) => set("exchangeRate", v)} />
          </div>
          {rateInfo && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink/45">
              <RefreshCw size={12} />
              {rateInfo.isRealtime
                ? `实时汇率（${new Date(rateInfo.fetchedAt).toLocaleString("zh-CN")}）`
                : "参考汇率（实时源不可用，使用缓存值）"}
            </p>
          )}
        </Section>

        <div className="flex gap-3">
          <button
            onClick={runCalc}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-bold text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)] transition-all hover:bg-accent/90 active:translate-y-0.5"
          >
            <Calculator size={16} />
            {computed && dirty ? "重新计算" : "立即计算"}
          </button>
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-ink/15 bg-paper-2 px-4 py-3 text-sm font-semibold text-ink/70 transition-colors hover:bg-ink/10"
          >
            <RotateCcw size={15} />
            重置
          </button>
        </div>

        {computed && (
          <div className="space-y-2">
            <button
              onClick={saveToList}
              disabled={saveState === "saving"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-accent bg-accent/5 px-5 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
            >
              <Bookmark size={15} />
              {saveState === "saving" ? "保存中…" : saveState === "saved" ? "✓ 已保存" : "保存到选品清单"}
            </button>
            {saveMsg && (
              <p
                className={`text-center text-xs ${
                  saveState === "error" ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {saveMsg}
                {saveState === "error" && /名额|升级|Pro/.test(saveMsg) && (
                  <a href="/my-profit/list" className="ml-1 underline">查看清单</a>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ================= 结果区 ================= */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        {computed ? (
          <Results
            result={computed.result}
            scenarios={computed.scenarios}
            costCurrency={form.costCurrency}
          />
        ) : (
          <div className="grid place-items-center rounded-xl border border-dashed border-ink/15 bg-card py-24 text-center">
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-accent/10 text-accent">
                <Calculator size={26} />
              </div>
              <p className="mt-4 text-sm font-semibold text-ink/70">填写参数后点击「立即计算」</p>
              <p className="mt-1 text-xs text-muted">
                将输出净利润、保本价、最高采购价与情景分析
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
