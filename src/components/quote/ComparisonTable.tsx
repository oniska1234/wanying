"use client";

import { AlertTriangle, ArrowDown, Lock } from "lucide-react";
import {
  fmtPrice,
  markLowest,
  getComparablePrice,
  getComparablePriceLocal,
  comparableTotal,
  commonItemsSubtotal,
  hasIncomparableItems,
  isFxPending,
  isTaxRatePending,
} from "@/lib/quote-utils";
import type { ComparisonProject } from "@/lib/quote-types";
import CurrencyPanel from "./CurrencyPanel";

interface Props {
  project: ComparisonProject;
  onCaliberChange: (
    taxMode: "original" | "inclusive" | "exclusive",
    includeShipping: boolean
  ) => void;
  onUpdateRate: (
    currency: string,
    patch: Partial<{ rate: number; confirmed: boolean; date: string; source: string }>
  ) => void;
  onBaseCurrencyChange: (baseCurrency: string) => void;
}

type TaxMode = "original" | "inclusive" | "exclusive";

export default function ComparisonTable({
  project,
  onCaliberChange,
  onUpdateRate,
  onBaseCurrencyChange,
}: Props) {
  const taxMode = project.taxMode;
  const includeShipping = project.includeShipping;
  const base = (project.baseCurrency ?? "CNY").toUpperCase();
  const ctx = { baseCurrency: base, rates: project.exchangeRates };

  const docs = project.documents.filter((d) => d.analyzed !== false);
  const suppliers = docs.map((d) => d.supplier);

  return (
    <div className="space-y-5">
      {/* currency & exchange rates (P0-02) */}
      <CurrencyPanel
        project={project}
        onUpdateRate={onUpdateRate}
        onBaseCurrencyChange={onBaseCurrencyChange}
      />

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-card p-3">
        <span className="text-xs font-bold uppercase tracking-wider text-ink/50">
          价格口径
        </span>
        <div className="flex gap-1 rounded-lg border border-ink/10 bg-paper-2 p-0.5">
          {([
            ["original", "原始"],
            ["inclusive", "统一含税"],
            ["exclusive", "统一未税"],
          ] as [TaxMode, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => onCaliberChange(k, includeShipping)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                taxMode === k ? "bg-ink text-paper" : "text-ink/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={includeShipping}
            onChange={(e) => onCaliberChange(taxMode, e.target.checked)}
            className="accent-[#3b5bdb]"
          />
          含运费分摊
        </label>
      </div>

      {/* comparison table */}
      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-card scroll-thin">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 bg-paper/40">
              <th className="sticky left-0 z-10 bg-paper/95 px-4 py-3 text-left text-xs font-bold text-muted">
                项目 / 规格
              </th>
              <th className="px-3 py-3 text-right text-xs font-bold text-muted">数量</th>
              {suppliers.map((s) => (
                <th key={s.id} className="px-3 py-3 text-right text-xs font-bold text-[#3b5bdb]">
                  {s.normalizedName}
                </th>
              ))}
              <th className="px-3 py-3 text-center text-xs font-bold text-muted">差异</th>
            </tr>
          </thead>
          <tbody>
            {project.matchGroups.map((mg) => {
              const lowest = markLowest(mg, project);
              return (
                <tr key={mg.id} className="border-b border-ink/5 hover:bg-paper/30">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3">
                    <p className="font-medium">{mg.normalizedName}</p>
                    <p className="text-xs text-muted">{mg.normalizedSpec}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-muted">
                    {(() => {
                      const first = docs
                        .flatMap((d) => d.lineItems)
                        .find((li) => mg.lineItemIds.includes(li.id));
                      return first ? `${first.quantity} ${first.unit}` : "—";
                    })()}
                  </td>
                  {docs.map((doc) => {
                    const li = doc.lineItems.find((l) => mg.lineItemIds.includes(l.id));
                    if (!li) {
                      return (
                        <td key={doc.id} className="px-3 py-3 text-right">
                          <span className="rounded bg-accent/5 px-2 py-0.5 text-xs text-accent">
                            缺失
                          </span>
                        </td>
                      );
                    }
                    const docCurrency = (doc.currency || base).toUpperCase();
                    const fxPending = isFxPending(doc, ctx);
                    const taxPending = isTaxRatePending(doc, taxMode);
                    // 本币可比价（始终可显示）
                    const local = getComparablePriceLocal(li, doc, taxMode, includeShipping);
                    // 基准币可比价（外币未确认汇率时为 null）
                    const price = getComparablePrice(li, doc, taxMode, includeShipping, ctx);
                    const isLowest = lowest.get(li.id) === true;
                    const isPossible = mg.status === "possible";

                    // 税率缺失：阻止静默折算（P1-03）
                    if (taxPending) {
                      return (
                        <td key={doc.id} className="px-3 py-3 text-right">
                          <span
                            className="rounded bg-gold/10 px-2 py-0.5 text-xs text-gold"
                            title="该报价含税但未提供税率，无法换算到统一口径，请在抽取复核中补充税率"
                          >
                            税率待确认
                          </span>
                        </td>
                      );
                    }

                    // 外币且汇率未确认：只显示原币金额，不参与比较（P0-02）
                    if (fxPending) {
                      return (
                        <td key={doc.id} className="px-3 py-3 text-right">
                          <span
                            className="inline-flex items-center gap-1 rounded bg-gold/10 px-2 py-0.5 font-mono text-xs text-gold"
                            title={`${docCurrency} 汇率未确认，不参与最低价比较`}
                          >
                            <Lock size={11} />
                            {fmtPrice(local, docCurrency)}
                          </span>
                        </td>
                      );
                    }

                    return (
                      <td
                        key={doc.id}
                        className={`px-3 py-3 text-right font-mono ${
                          isLowest
                            ? "bg-pine/5 font-bold text-pine"
                            : isPossible
                              ? "bg-gold/5 text-gold"
                              : ""
                        }`}
                      >
                        {fmtPrice(price, base)}
                        {docCurrency !== base && (
                          <span className="ml-1 text-[10px] font-normal text-muted">
                            ({fmtPrice(local, docCurrency)})
                          </span>
                        )}
                        {isLowest && (
                          <ArrowDown size={11} className="ml-1 inline text-pine" />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-center text-xs">
                    {mg.status === "possible" ? (
                      <span className="flex items-center justify-center gap-0.5 text-gold">
                        <AlertTriangle size={12} /> 待确认
                      </span>
                    ) : mg.status === "unique" ? (
                      <span className="text-ink/40">独有</span>
                    ) : (
                      <span className="text-pine">可比</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* summary rows */}
            <tr className="border-t-2 border-ink/10 bg-paper/40 font-bold">
              <td className="sticky left-0 z-10 bg-paper/95 px-4 py-3">币种</td>
              <td></td>
              {docs.map((doc) => {
                const c = (doc.currency || base).toUpperCase();
                return (
                  <td key={doc.id} className="px-3 py-3 text-right text-sm">
                    <span className="font-mono">{c}</span>
                    {isFxPending(doc, ctx) && (
                      <span className="ml-1 text-[10px] font-normal text-gold">待确认</span>
                    )}
                  </td>
                );
              })}
              <td></td>
            </tr>
            <tr className="bg-paper/40 font-bold">
              <td className="sticky left-0 z-10 bg-paper/95 px-4 py-3">运费</td>
              <td></td>
              {docs.map((doc) => {
                const c = (doc.currency || base).toUpperCase();
                return (
                  <td key={doc.id} className="px-3 py-3 text-right text-sm">
                    {doc.shippingStatus === "included"
                      ? "包含"
                      : doc.shippingFee != null
                        ? fmtPrice(doc.shippingFee, c)
                        : <span className="text-gold">未知</span>}
                  </td>
                );
              })}
              <td></td>
            </tr>
            <tr className="bg-paper/40 font-bold">
              <td className="sticky left-0 z-10 bg-paper/95 px-4 py-3">税费</td>
              <td></td>
              {docs.map((doc) => (
                <td key={doc.id} className="px-3 py-3 text-right text-sm">
                  {doc.taxInclusive ? "含税" : "未税"} {doc.taxRate != null && `${(doc.taxRate * 100).toFixed(0)}%`}
                </td>
              ))}
              <td></td>
            </tr>
            <tr className="bg-paper/40 font-bold">
              <td className="sticky left-0 z-10 bg-paper/95 px-4 py-3">交期</td>
              <td></td>
              {docs.map((doc) => (
                <td key={doc.id} className="px-3 py-3 text-right text-sm">
                  {doc.deliveryDays != null ? `${doc.deliveryDays} 天` : "未知"}
                </td>
              ))}
              <td></td>
            </tr>
            <tr className="border-t-2 border-ink/20 bg-paper/40 font-bold text-ink">
              <td className="sticky left-0 z-10 bg-paper/95 px-4 py-3">报价总价（原币）</td>
              <td></td>
              {docs.map((doc) => {
                const c = (doc.currency || base).toUpperCase();
                return (
                  <td key={doc.id} className="px-3 py-3 text-right text-sm">
                    {fmtPrice(doc.totalPrice, c)}
                  </td>
                );
              })}
              <td></td>
            </tr>
            <tr className="bg-[#3b5bdb]/5 font-bold text-[#3b5bdb]">
              <td className="sticky left-0 z-10 bg-[#3b5bdb]/5 px-4 py-3" title="统一到当前口径、并按已确认汇率折算到基准币的总价；不可比时为空">
                可比总价（{base}）
              </td>
              <td></td>
              {docs.map((doc) => {
                // P1-01：存在独有项 / 规格冲突时整单不可比
                const incomparable = hasIncomparableItems(project);
                const ct = incomparable ? null : comparableTotal(doc, taxMode, includeShipping, ctx);
                return (
                  <td key={doc.id} className="px-3 py-3 text-right text-sm">
                    {ct != null ? (
                      fmtPrice(ct, base)
                    ) : (
                      <span
                        className="text-[11px] font-normal text-gold"
                        title={incomparable ? "存在不同配置独有项，整单总价不可直接比较" : "税率 / 运费 / 汇率待确认，暂不可比"}
                      >
                        {incomparable ? "不可比（配置不同）" : "不可比"}
                      </span>
                    )}
                  </td>
                );
              })}
              <td></td>
            </tr>
            {/* P1-01：共同项目小计（仅统计所有供应商均参与的确认组） */}
            {hasIncomparableItems(project) && (
              <tr className="border-t border-dashed border-ink/10 text-ink/70">
                <td className="sticky left-0 z-10 bg-card px-4 py-2.5 text-xs font-semibold" title="仅统计所有供应商均包含且规格相容的确认组行项目">
                  共同项目小计（{base}）
                </td>
                <td></td>
                {docs.map((doc) => {
                  const sub = commonItemsSubtotal(doc, project, taxMode, includeShipping, ctx);
                  return (
                    <td key={doc.id} className="px-3 py-2.5 text-right text-xs font-mono">
                      {sub != null ? fmtPrice(sub, base) : <span className="text-gold">无共同项</span>}
                    </td>
                  );
                })}
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* anomalies */}
      {project.anomalies.length > 0 && (
        <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gold">
            <AlertTriangle size={15} /> 异常与待确认项（{project.anomalies.length}）
          </h3>
          <ul className="space-y-1.5 text-sm">
            {project.anomalies.map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    a.severity === "error" ? "bg-accent" : a.severity === "warning" ? "bg-gold" : "bg-ink/30"
                  }`}
                />
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
