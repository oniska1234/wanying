"use client";

import { X, FileText, Cpu, FileSpreadsheet, Image as ImageIcon, File as FileIcon } from "lucide-react";
import type { LineItem, QuoteDocument, EvidenceAnchor } from "@/lib/quote-types";

interface Props {
  item: LineItem;
  /** 所属文档（用于展示原始文件名） */
  doc?: QuoteDocument;
  onClose: () => void;
}

const SOURCE_META: Record<
  NonNullable<EvidenceAnchor["sourceType"]>,
  { label: string; icon: typeof FileText; cls: string }
> = {
  pdf: { label: "PDF 文本层", icon: FileText, cls: "text-[#3b5bdb] bg-[#3b5bdb]/10" },
  excel: { label: "Excel 单元格", icon: FileSpreadsheet, cls: "text-pine bg-pine/10" },
  image: { label: "图片 OCR", icon: ImageIcon, cls: "text-gold bg-gold/10" },
  ai: { label: "AI 模型抽取", icon: Cpu, cls: "text-accent bg-accent/10" },
};

/** 比较 AI 原始值与当前值，返回被人工修改过的字段 */
function manualChanges(item: LineItem): { label: string; from: string; to: string }[] {
  const av = item.aiValues;
  if (!av) return [];
  const fmt = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const rows: { key: keyof NonNullable<LineItem["aiValues"]>; label: string }[] = [
    { key: "originalName", label: "名称" },
    { key: "spec", label: "规格" },
    { key: "brand", label: "品牌" },
    { key: "quantity", label: "数量" },
    { key: "unit", label: "单位" },
    { key: "unitPrice", label: "单价" },
    { key: "subtotal", label: "小计" },
    { key: "taxRate", label: "税率" },
  ];
  const changes: { label: string; from: string; to: string }[] = [];
  for (const r of rows) {
    const from = av[r.key];
    const to = item[r.key];
    if (fmt(from) !== fmt(to)) {
      changes.push({ label: r.label, from: fmt(from), to: fmt(to) });
    }
  }
  return changes;
}

export default function EvidencePopover({ item, doc, onClose }: Props) {
  const changes = manualChanges(item);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink/10 bg-card p-5 shadow-xl scroll-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold">原文证据与审计轨迹</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-accent">
            <X size={18} />
          </button>
        </div>

        <p className="mt-2 text-sm text-muted">行项目：{item.originalName}</p>
        {doc && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <FileIcon size={12} /> 来源文件：{doc.fileName}
          </p>
        )}

        {/* 原文证据 */}
        <div className="mt-4 space-y-3">
          {item.evidence.length === 0 ? (
            <p className="rounded-lg bg-accent/5 p-3 text-sm text-accent">
              无原文证据，该字段可能由 AI 推断。
            </p>
          ) : (
            item.evidence.map((ev, i) => {
              const meta = ev.sourceType ? SOURCE_META[ev.sourceType] : null;
              const Icon = meta?.icon ?? FileText;
              return (
                <div key={i} className="rounded-lg border border-ink/10 bg-paper/60 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {meta && (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${meta.cls}`}
                      >
                        <Icon size={11} /> {meta.label}
                      </span>
                    )}
                    {/* Excel 来源显示工作表+单元格，否则显示页码 */}
                    {ev.cell ? (
                      <span className="font-mono">
                        {ev.sheetName ? `${ev.sheetName}!${ev.cell}` : ev.cell}
                      </span>
                    ) : (
                      <span>第 {ev.page} 页</span>
                    )}
                    {ev.ocrConfidence != null && (
                      <span className="ml-auto">
                        OCR 置信度：{(ev.ocrConfidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-2 rounded bg-gold/10 px-2 py-1.5 font-mono text-sm leading-relaxed">
                    {ev.text}
                  </p>
                  {ev.basis && (
                    <p className="mt-1.5 text-[11px] text-muted">依据：{ev.basis}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* AI 解析值 vs 人工修改值 */}
        {changes.length > 0 && (
          <div className="mt-4 rounded-lg border border-accent/20 bg-accent/5 p-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-accent">
              人工修改记录（AI 原值 → 当前值）
            </h4>
            <ul className="space-y-1 text-sm">
              {changes.map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-muted">{c.label}</span>
                  <span className="font-mono text-ink/50 line-through">{c.from}</span>
                  <span className="text-ink/40">→</span>
                  <span className="font-mono font-semibold text-accent">{c.to}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted">
            字段置信度：
            <span
              className={
                item.confidence === "high"
                  ? "text-pine"
                  : item.confidence === "medium"
                    ? "text-gold"
                    : "text-accent"
              }
            >
              {" "}
              {item.confidence === "high" ? "高" : item.confidence === "medium" ? "中" : "低"}
            </span>
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-paper-2 px-4 py-2 text-sm font-semibold hover:bg-ink/10"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
