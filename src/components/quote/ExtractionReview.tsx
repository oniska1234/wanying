"use client";

import { useState, type ReactNode } from "react";
import { Eye, AlertTriangle, PencilLine } from "lucide-react";
import { Btn } from "@/components/ui";
import { fmtPrice } from "@/lib/quote-utils";
import type {
  QuoteDocument,
  LineItem,
  ConfidenceLevel,
} from "@/lib/quote-types";
import EvidencePopover from "./EvidencePopover";

interface Props {
  documents: QuoteDocument[];
  onUpdateDocument: (docId: string, patch: Partial<QuoteDocument>) => void;
  onUpdateLineItem: (
    docId: string,
    itemId: string,
    patch: Partial<LineItem>
  ) => void;
  onContinue: () => void;
}

const confBadge: Record<ConfidenceLevel, string> = {
  high: "bg-pine/10 text-pine",
  medium: "bg-gold/10 text-gold",
  low: "bg-accent/10 text-accent",
};

const inputCls =
  "mt-0.5 w-full rounded border-b border-transparent bg-transparent text-sm font-medium outline-none focus:border-[#3b5bdb]";

const cellCls =
  "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-ink/10 focus:border-[#3b5bdb] focus:bg-white";

function EditField({
  label,
  conf,
  children,
}: {
  label: string;
  conf?: ConfidenceLevel;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-paper/60 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted">{label}</span>
        {conf && conf !== "high" && (
          <span className={`rounded px-1 text-[10px] font-bold ${confBadge[conf]}`}>
            {conf === "medium" ? "待确认" : "低"}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function toNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function ExtractionReview({
  documents,
  onUpdateDocument,
  onUpdateLineItem,
  onContinue,
}: Props) {
  const [activeDoc, setActiveDoc] = useState(0);
  const [evidenceItem, setEvidenceItem] = useState<LineItem | null>(null);

  const doc = documents[activeDoc];
  if (!doc) return null;

  const lowConfItems = doc.lineItems.filter((li) => li.confidence !== "high");
  const editedCount = doc.lineItems.filter((li) => li.userConfirmed).length;

  // 编辑行项目并实时重算小计
  const editItem = (itemId: string, patch: Partial<LineItem>) => {
    const item = doc.lineItems.find((li) => li.id === itemId);
    if (!item) return;
    const next = { ...item, ...patch };
    const recalc: Partial<LineItem> = { ...patch, userConfirmed: true };
    if (next.quantity != null && next.unitPrice != null) {
      recalc.subtotal = Math.round(next.quantity * next.unitPrice * 100) / 100;
    }
    onUpdateLineItem(doc.id, itemId, recalc);
  };

  return (
    <div className="space-y-5">
      {/* doc tabs */}
      <div className="flex gap-2 overflow-x-auto">
        {documents.map((d, i) => (
          <button
            key={d.id}
            onClick={() => setActiveDoc(i)}
            className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              i === activeDoc
                ? "border-[#3b5bdb] bg-[#3b5bdb]/10 text-[#3b5bdb]"
                : "border-ink/10 text-ink/60 hover:border-ink/20"
            }`}
          >
            {d.supplier.normalizedName}
          </button>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <PencilLine size={13} className="text-[#3b5bdb]" />
        点击任意字段即可修改，数量 / 单价修改后小计自动重算。人工确认值将优先保留。
      </p>

      {/* supplier info (editable) */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink/50">
          供应商基础信息
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <EditField label="供应商" conf={doc.fieldConfidence.supplier}>
            <input
              className={inputCls}
              value={doc.supplier.originalName}
              onChange={(e) =>
                onUpdateDocument(doc.id, {
                  supplier: { ...doc.supplier, originalName: e.target.value },
                })
              }
            />
          </EditField>

          <EditField label="报价日期" conf={doc.fieldConfidence.quoteDate}>
            <input
              className={inputCls}
              value={doc.quoteDate ?? ""}
              placeholder="YYYY-MM-DD"
              onChange={(e) => onUpdateDocument(doc.id, { quoteDate: e.target.value })}
            />
          </EditField>

          <EditField label="有效期">
            <input
              className={inputCls}
              value={doc.validUntil ?? ""}
              placeholder="YYYY-MM-DD"
              onChange={(e) => onUpdateDocument(doc.id, { validUntil: e.target.value })}
            />
          </EditField>

          <EditField label="税率 (%)" conf={doc.fieldConfidence.taxRate}>
            <input
              type="number"
              className={inputCls}
              value={doc.taxRate != null ? doc.taxRate * 100 : ""}
              onChange={(e) =>
                onUpdateDocument(doc.id, {
                  taxRate: toNum(e.target.value) != null ? toNum(e.target.value)! / 100 : null,
                })
              }
            />
          </EditField>

          <EditField label="币种" conf={doc.fieldConfidence.currency}>
            <select
              className={inputCls}
              value={doc.currency ?? ""}
              onChange={(e) => onUpdateDocument(doc.id, { currency: e.target.value || undefined })}
            >
              <option value="">待确认</option>
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
              <option value="EUR">EUR 欧元</option>
              <option value="HKD">HKD 港币</option>
              <option value="JPY">JPY 日元</option>
              <option value="GBP">GBP 英鎊</option>
            </select>
          </EditField>

          <EditField label="含税">
            <select
              className={inputCls}
              value={doc.taxInclusive == null ? "" : doc.taxInclusive ? "yes" : "no"}
              onChange={(e) =>
                onUpdateDocument(doc.id, {
                  taxInclusive: e.target.value === "" ? null : e.target.value === "yes",
                })
              }
            >
              <option value="">未知</option>
              <option value="yes">是</option>
              <option value="no">否</option>
            </select>
          </EditField>

          <EditField label={`总价 (${doc.currency || "币种待确认"})`} conf={doc.fieldConfidence.totalPrice}>
            <input
              type="number"
              className={inputCls}
              value={doc.totalPrice ?? ""}
              onChange={(e) => onUpdateDocument(doc.id, { totalPrice: toNum(e.target.value) })}
            />
          </EditField>

          <EditField label={`运费 (${doc.currency || "币种待确认"})`} conf={doc.fieldConfidence.shippingFee}>
            <input
              type="number"
              className={inputCls}
              value={doc.shippingFee ?? ""}
              onChange={(e) => onUpdateDocument(doc.id, { shippingFee: toNum(e.target.value) })}
            />
          </EditField>

          <EditField label="交期 (天)">
            <input
              type="number"
              className={inputCls}
              value={doc.deliveryDays ?? ""}
              onChange={(e) => onUpdateDocument(doc.id, { deliveryDays: toNum(e.target.value) })}
            />
          </EditField>

          <EditField label="付款条件">
            <input
              className={inputCls}
              value={doc.paymentTerms ?? ""}
              onChange={(e) => onUpdateDocument(doc.id, { paymentTerms: e.target.value })}
            />
          </EditField>

          <EditField label="质保">
            <input
              className={inputCls}
              value={doc.warranty ?? ""}
              onChange={(e) => onUpdateDocument(doc.id, { warranty: e.target.value })}
            />
          </EditField>

          <EditField label="联系人">
            <input
              className={inputCls}
              value={doc.supplier.contact ?? ""}
              onChange={(e) =>
                onUpdateDocument(doc.id, {
                  supplier: { ...doc.supplier, contact: e.target.value },
                })
              }
            />
          </EditField>
        </div>
      </div>

      {/* line items (editable) */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-ink/50">
            行项目（{doc.lineItems.length} 项）
          </h3>
          <div className="flex items-center gap-3 text-xs">
            {editedCount > 0 && (
              <span className="text-[#3b5bdb]">已修改 {editedCount} 项</span>
            )}
            {lowConfItems.length > 0 && (
              <span className="flex items-center gap-1 text-gold">
                <AlertTriangle size={13} /> {lowConfItems.length} 项需确认
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-muted">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">名称</th>
                <th className="py-2 pr-3">规格</th>
                <th className="py-2 pr-3 text-right">数量</th>
                <th className="py-2 pr-3">单位</th>
                <th className="py-2 pr-3 text-right">单价</th>
                <th className="py-2 pr-3 text-right">小计</th>
                <th className="py-2 pr-3">置信度</th>
                <th className="py-2">证据</th>
              </tr>
            </thead>
            <tbody>
              {doc.lineItems.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-ink/5 hover:bg-paper/40 ${
                    item.userConfirmed ? "bg-[#3b5bdb]/[0.03]" : ""
                  }`}
                >
                  <td className="py-2 pr-3 text-muted">{item.originalIndex}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      className={`${cellCls} min-w-[160px] font-medium`}
                      value={item.originalName}
                      onChange={(e) => editItem(item.id, { originalName: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      className={`${cellCls} min-w-[150px] text-xs text-muted`}
                      value={item.spec}
                      onChange={(e) => editItem(item.id, { spec: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input
                      type="number"
                      className={`${cellCls} text-right font-mono`}
                      value={item.quantity ?? ""}
                      onChange={(e) => editItem(item.id, { quantity: toNum(e.target.value) })}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      className={`${cellCls} w-14`}
                      value={item.unit}
                      onChange={(e) => editItem(item.id, { unit: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input
                      type="number"
                      className={`${cellCls} text-right font-mono`}
                      value={item.unitPrice ?? ""}
                      onChange={(e) => editItem(item.id, { unitPrice: toNum(e.target.value) })}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-ink/70">
                    {fmtPrice(item.subtotal, doc.currency ?? undefined)}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${confBadge[item.confidence]}`}
                    >
                      {item.confidence === "high" ? "高" : item.confidence === "medium" ? "中" : "低"}
                    </span>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => setEvidenceItem(item)}
                      className="text-[#3b5bdb] hover:underline"
                    >
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* evidence popover */}
      {evidenceItem && (
        <EvidencePopover item={evidenceItem} doc={doc} onClose={() => setEvidenceItem(null)} />
      )}

      {/* action */}
      <div className="flex justify-end">
        <Btn onClick={onContinue}>确认无误，进入匹配 →</Btn>
      </div>
    </div>
  );
}
