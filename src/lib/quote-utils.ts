import * as XLSX from "xlsx";
import type {
  ComparisonProject,
  LineItem,
  MatchGroup,
  Anomaly,
  QuoteDocument,
} from "./quote-types";
import { buildMatchGroupsLocal, enforceSpecIsolation } from "./quote-match";

// ============================================================
// 报价齐 · 工具函数
// ============================================================

/**
 * 建议汇率（基准币 CNY）。仅作为「待确认」的显式建议预填，
 * confirmed 始终为 false，未确认前不参与折算（P0-02 / P1-03 原则：
 * 任何默认值都必须显式且需用户确认）。
 */
export const SUGGESTED_FX_TO_CNY: Record<string, number> = {
  USD: 7.2,
  EUR: 7.8,
  HKD: 0.92,
  JPY: 0.048,
  GBP: 9.1,
};

/** 收集已分析文档中出现的全部币种（去重、大写） */
export function detectCurrencies(documents: QuoteDocument[]): string[] {
  const set = new Set<string>();
  for (const d of documents) {
    if (d.analyzed === false) continue;
    const c = (d.currency || "CNY").toUpperCase();
    set.add(c);
  }
  return Array.from(set);
}

/** 由文档币种生成「未确认」汇率表（基准币除外） */
export function seedExchangeRates(
  documents: QuoteDocument[],
  baseCurrency = "CNY"
): ComparisonProject["exchangeRates"] {
  const base = baseCurrency.toUpperCase();
  const rates: NonNullable<ComparisonProject["exchangeRates"]> = {};
  for (const c of detectCurrencies(documents)) {
    if (c === base) continue;
    const suggested = SUGGESTED_FX_TO_CNY[c];
    rates[c] = {
      rate: suggested ?? 0,
      confirmed: false,
      source: suggested != null ? "系统建议，需人工确认" : undefined,
    };
  }
  return rates;
}

/** 校验行项目：数量 × 单价 vs 小计 */
export function verifyLineItem(item: LineItem): {
  ok: boolean;
  expected: number | null;
  diff: number | null;
} {
  if (item.quantity == null || item.unitPrice == null || item.subtotal == null)
    return { ok: true, expected: null, diff: null };
  const expected = Math.round(item.quantity * item.unitPrice * 100) / 100;
  const diff = Math.round((item.subtotal - expected) * 100) / 100;
  return { ok: Math.abs(diff) < 0.01, expected, diff };
}

/** 含税/未税互转 */
export function normalizeTax(
  price: number,
  rate: number,
  fromInclusive: boolean,
  toInclusive: boolean
): number {
  if (fromInclusive === toInclusive) return price;
  if (fromInclusive) {
    // 含税 → 未税
    return Math.round((price / (1 + rate)) * 100) / 100;
  }
  // 未税 → 含税
  return Math.round(price * (1 + rate) * 100) / 100;
}

/** 行项目金额（小计优先，否则 数量×单价） */
export function lineAmount(item: LineItem): number {
  if (item.subtotal != null) return item.subtotal;
  if (item.quantity != null && item.unitPrice != null)
    return item.quantity * item.unitPrice;
  return 0;
}

/**
 * 单位运费分摊（守恒）。
 * 按各行金额占文档总金额的比例分摊运费总额，再除以该行数量得到单位运费。
 * 保证：Σ(单位运费 × 数量) = 运费总额，不会放大报价。
 */
export function shippingPerUnit(item: LineItem, doc: QuoteDocument): number {
  if (doc.shippingFee == null || doc.shippingFee <= 0) return 0;
  if (item.quantity == null || item.quantity <= 0) return 0;
  const totalAmount = doc.lineItems.reduce((s, li) => s + lineAmount(li), 0);
  if (totalAmount <= 0) return 0;
  const lineShare = doc.shippingFee * (lineAmount(item) / totalAmount);
  return Math.round((lineShare / item.quantity) * 100) / 100;
}

/** 税费口径 */
export type TaxMode = "original" | "inclusive" | "exclusive";

/** 价格折算上下文（基准币 + 汇率表） */
export interface PriceCtx {
  baseCurrency?: string;
  rates?: ComparisonProject["exchangeRates"];
}

function ctxBase(ctx?: PriceCtx): string {
  return (ctx?.baseCurrency ?? "CNY").toUpperCase();
}
function docCur(doc: QuoteDocument): string {
  return (doc.currency || "CNY").toUpperCase();
}

/**
 * 行项目在「文档本币」下、统一税费 / 运费口径后的可比单价。
 * 当税费口径转换需要税率但税率缺失时返回 null（不静默按 13%，P1-03）。
 */
export function getComparablePriceLocal(
  item: LineItem,
  doc: QuoteDocument,
  taxMode: TaxMode,
  includeShipping: boolean
): number | null {
  if (item.unitPrice == null) return null;
  let price = item.unitPrice;
  const docInclusive = doc.taxInclusive ?? false;
  const needRate =
    (taxMode === "inclusive" && !docInclusive) ||
    (taxMode === "exclusive" && docInclusive);
  if (needRate) {
    if (doc.taxRate == null) return null; // 未知税率：禁止静默折算
    price = normalizeTax(price, doc.taxRate, docInclusive, taxMode === "inclusive");
  }
  if (includeShipping) price += shippingPerUnit(item, doc);
  return Math.round(price * 100) / 100;
}

/** 将本币金额折算到基准币；外币且汇率未确认 / 无效时返回 null（P0-02） */
export function toBase(
  amount: number | null,
  docCurrency: string | null | undefined,
  ctx?: PriceCtx
): number | null {
  if (amount == null) return null;
  const cur = (docCurrency || "CNY").toUpperCase();
  if (cur === ctxBase(ctx)) return amount;
  const r = ctx?.rates?.[cur];
  if (!r || !r.confirmed || !(r.rate > 0)) return null;
  return Math.round(amount * r.rate * 100) / 100;
}

/**
 * 行项目在「基准币」下的可比单价（本币口径 × 已确认汇率）。
 * 未传 ctx 时视为基准币 CNY、无汇率（兼容旧调用与单测）。
 */
export function getComparablePrice(
  item: LineItem,
  doc: QuoteDocument,
  taxMode: TaxMode,
  includeShipping: boolean,
  ctx?: PriceCtx
): number | null {
  const local = getComparablePriceLocal(item, doc, taxMode, includeShipping);
  return toBase(local, doc.currency, ctx);
}

/** 该文档是否「汇率待确认」（外币且未确认 / 汇率无效） */
export function isFxPending(doc: QuoteDocument, ctx?: PriceCtx): boolean {
  if (docCur(doc) === ctxBase(ctx)) return false;
  const r = ctx?.rates?.[docCur(doc)];
  return !r || !r.confirmed || !(r.rate > 0);
}

/** 该文档在当前口径下是否「税率待确认」 */
export function isTaxRatePending(doc: QuoteDocument, taxMode: TaxMode): boolean {
  const docInclusive = doc.taxInclusive ?? false;
  const needRate =
    (taxMode === "inclusive" && !docInclusive) ||
    (taxMode === "exclusive" && docInclusive);
  return needRate && doc.taxRate == null;
}

/**
 * 文档「可比总价」（基准币）。
 * 口径：以文档总价（或行项目之和）为基础，统一到目标税费口径，
 * 勾选含运费且运费单列时加上运费，再按已确认汇率折算到基准币。
 * 返回 null 表示不可比：税率缺失（P1-03）/ 运费未知（CASE03 供应商A）/
 * 外币汇率未确认（P0-02）。绝不静默补 0 或 13%。
 */
export function comparableTotal(
  doc: QuoteDocument,
  taxMode: TaxMode,
  includeShipping: boolean,
  ctx?: PriceCtx
): number | null {
  const docInclusive = doc.taxInclusive ?? false;
  const needRate =
    (taxMode === "inclusive" && !docInclusive) ||
    (taxMode === "exclusive" && docInclusive);
  if (needRate && doc.taxRate == null) return null; // 税率未知 → 不可比

  const shipKnown =
    doc.shippingStatus === "included" || doc.shippingFee != null;
  if (!shipKnown) return null; // 运费未知 → 不可比（不得按 0 处理）

  const lineSum = doc.lineItems.reduce((s, li) => s + lineAmount(li), 0);
  let total = doc.totalPrice ?? lineSum;
  if (needRate && doc.taxRate != null) {
    total = normalizeTax(total, doc.taxRate, docInclusive, taxMode === "inclusive");
  }
  if (includeShipping && doc.shippingStatus === "separate" && doc.shippingFee != null) {
    total += doc.shippingFee;
  }
  return toBase(Math.round(total * 100) / 100, doc.currency, ctx);
}

/**
 * 项目是否存在「不可比配置」（P1-01 第四轮）：
 * 当存在独有项、缺失项或规格冲突隔离时，整单总价不可直接比较。
 */
export function hasIncomparableItems(project: ComparisonProject): boolean {
  return project.matchGroups.some(
    (g) => g.status === "unique" || g.status === "possible"
  );
}

/**
 * 「共同项目小计」（P1-01）：仅统计所有供应商均参与且规格相容的确认组行项目。
 * 返回基准币金额；无共同项目时返回 null。
 */
export function commonItemsSubtotal(
  doc: QuoteDocument,
  project: ComparisonProject,
  taxMode: TaxMode,
  includeShipping: boolean,
  ctx?: PriceCtx
): number | null {
  const confirmedIds = new Set<string>();
  for (const g of project.matchGroups) {
    if (g.status !== "confirmed") continue;
    for (const id of g.lineItemIds) confirmedIds.add(id);
  }
  if (confirmedIds.size === 0) return null;
  let sum = 0;
  let count = 0;
  for (const li of doc.lineItems) {
    if (!confirmedIds.has(li.id)) continue;
    const p = getComparablePriceLocal(li, doc, taxMode, includeShipping);
    if (p == null) continue;
    sum += p * (li.quantity ?? 1);
    count++;
  }
  if (count === 0) return null;
  return toBase(Math.round(sum * 100) / 100, doc.currency, ctx);
}

/** 标记匹配组中的最低价（仅纳入已折算到基准币的可比价） */
export function markLowest(
  group: MatchGroup,
  project: ComparisonProject
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const prices: { id: string; price: number }[] = [];
  const ctx: PriceCtx = {
    baseCurrency: project.baseCurrency,
    rates: project.exchangeRates,
  };

  for (const liId of group.lineItemIds) {
    const doc = project.documents.find((d) =>
      d.lineItems.some((li) => li.id === liId)
    );
    const item = doc?.lineItems.find((li) => li.id === liId);
    if (!item || !doc) continue;
    const p = getComparablePrice(
      item,
      doc,
      project.taxMode,
      project.includeShipping,
      ctx
    );
    if (p != null) prices.push({ id: liId, price: p });
  }

  // P2-02 第五轮：少于 2 家可比时无比较对象，不标注最低价
  if (prices.length < 2) return result;
  const min = Math.min(...prices.map((p) => p.price));
  for (const p of prices) {
    result.set(p.id, p.price === min);
  }
  return result;
}

/**
 * 总价对账（按报价口径，P1-04）。
 * 重建「应为总价」= 行项目之和 + 税费（未税报价且税率已知）+ 单列运费，
 * 再与文档总价比较。能解释的税费 / 运费差额不报为算术错误；
 * 税率缺失无法重建时返回 cannotReconstruct，交由「未知税率」提示处理。
 */
export interface ReconcileResult {
  status: "ok" | "diff" | "cannotReconstruct";
  expected?: number;
  diff?: number;
}

export function reconcileTotal(doc: QuoteDocument): ReconcileResult {
  if (doc.totalPrice == null) return { status: "ok" };
  const lineSum = doc.lineItems.reduce((s, li) => s + lineAmount(li), 0);
  if (lineSum <= 0) return { status: "ok" };

  const inclusive = doc.taxInclusive ?? false;
  let expected = lineSum;
  if (!inclusive) {
    // 未税报价：总价通常含税，需要税率才能重建
    if (doc.taxRate == null) return { status: "cannotReconstruct" };
    expected = expected * (1 + doc.taxRate);
  }
  if (doc.shippingStatus === "separate" && doc.shippingFee != null) {
    expected += doc.shippingFee;
  }
  expected = Math.round(expected * 100) / 100;
  const diff = Math.round((doc.totalPrice - expected) * 100) / 100;
  const tol = Math.max(1, Math.abs(doc.totalPrice) * 0.005);
  return Math.abs(diff) <= tol
    ? { status: "ok", expected, diff }
    : { status: "diff", expected, diff };
}

/** 确定性异常检测 */
export function detectAnomalies(project: ComparisonProject): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const doc of project.documents) {
    // 跳过未纳入分析的文件（仅质量检查）
    if (doc.analyzed === false) continue;
    // 小计校验
    for (const item of doc.lineItems) {
      const v = verifyLineItem(item);
      if (!v.ok) {
        anomalies.push({
          id: `ano-math-${item.id}`,
          type: "math_error",
          severity: "error",
          message: `${doc.supplier.normalizedName}「${item.originalName}」数量×单价=${v.expected}，与小计${item.subtotal}不符`,
          docId: doc.id,
          lineItemId: item.id,
          expected: String(v.expected),
          actual: String(item.subtotal),
        });
      }
    }

    // 行项目之和 vs 总价（按报价口径对账，P1-04）
    const rec = reconcileTotal(doc);
    if (rec.status === "diff") {
      anomalies.push({
        id: `ano-sum-${doc.id}`,
        type: "math_error",
        severity: "warning",
        message: `${doc.supplier.normalizedName} 按口径重建总价≈${rec.expected}（行项目之和${
          doc.taxInclusive === false && doc.taxRate != null
            ? "×(1+税率)"
            : ""
        }${doc.shippingStatus === "separate" ? "+运费" : ""}），与报价总价${
          doc.totalPrice
        }不符，差额${rec.diff}`,
        docId: doc.id,
        expected: String(rec.expected),
        actual: String(doc.totalPrice),
      });
    } else if (rec.status === "cannotReconstruct") {
      anomalies.push({
        id: `ano-rate-${doc.id}`,
        type: "missing_value",
        severity: "info",
        message: `${doc.supplier.normalizedName} 为未税报价但未提供税率，无法校验总价与换算统一口径，请补充税率`,
        docId: doc.id,
      });
    }

    // 含税但税率缺失：不得静默按 13%（P1-03）
    if (doc.taxInclusive === true && doc.taxRate == null) {
      anomalies.push({
        id: `ano-taxrate-${doc.id}`,
        type: "missing_value",
        severity: "warning",
        message: `${doc.supplier.normalizedName} 含税报价但未提供税率；系统不会默认按 13% 处理，切换统一口径时将标记为「税率待确认」`,
        docId: doc.id,
      });
    }

    // 运费未知
    if (doc.shippingStatus === "unknown") {
      anomalies.push({
        id: `ano-ship-${doc.id}`,
        type: "missing_value",
        severity: "warning",
        message: `${doc.supplier.normalizedName} 运费状态未知`,
        docId: doc.id,
      });
    }

    // 税费口径不一致
    if (doc.taxInclusive === false) {
      const others = project.documents.filter(
        (d) => d.id !== doc.id && d.taxInclusive === true
      );
      if (others.length > 0) {
        anomalies.push({
          id: `ano-tax-${doc.id}`,
          type: "tax_mismatch",
          severity: "info",
          message: `${doc.supplier.normalizedName} 为未税报价，与含税报价对比需注意口径`,
          docId: doc.id,
        });
      }
    }
  }

  return anomalies;
}

/** 格式化金额 */
export function fmtPrice(n: number | null, currency = "CNY"): string {
  if (n == null) return "—";
  const sym = currency === "CNY" ? "¥" : currency + " ";
  return sym + n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 匹配状态中文标签 */
export function matchStatusLabel(status: MatchGroup["status"]): string {
  return (
    {
      confirmed: "确定匹配",
      possible: "可能匹配",
      unmatched: "不匹配",
      unique: "独有项目",
    } as const
  )[status];
}

/** 生成当前口径与假设说明 */
export function caliberNotes(project: ComparisonProject): string[] {
  const taxLabel =
    project.taxMode === "inclusive"
      ? "统一含税"
      : project.taxMode === "exclusive"
        ? "统一未税"
        : "原始报价口径";
  const notes: string[] = [
    `价格口径：${taxLabel}`,
    `运费分摊：${
      project.includeShipping
        ? "已勾选，按各行金额占比守恒分摊到单价（Σ分摊额 = 运费总额）"
        : "未计入运费"
    }`,
    "长文本（完整规格 / 人工修改记录 / 证据原文）不截断版本见「审计轨迹」工作表",
  ];
  if (project.demoMode)
    notes.push("演示模式：以下为内置示例数据，非真实 AI 抽取结果，仅用于流程演示");

  // 币种与汇率（P0-02）
  const base = (project.baseCurrency ?? "CNY").toUpperCase();
  const rates = project.exchangeRates ?? {};
  const rateKeys = Object.keys(rates);
  notes.push("", `基准币：${base}`);
  if (rateKeys.length === 0) {
    notes.push("汇率：全部报价均为基准币，无需折算");
  } else {
    notes.push("汇率（未确认者不参与最低价 / 可比总价计算）：");
    for (const c of rateKeys) {
      const r = rates[c];
      notes.push(
        `  1 ${c} = ${r.rate || "—"} ${base}｜${r.confirmed ? "已确认" : "待确认"}${
          r.date ? "｜日期 " + r.date : ""
        }${r.source ? "｜来源：" + r.source : ""}`
      );
    }
  }

  notes.push("", "各供应商税费 / 运费状态：");
  for (const doc of project.documents) {
    if (doc.analyzed === false) continue;
    const tax = `${doc.taxInclusive ? "含税" : "未税"}${
      doc.taxRate != null ? " " + (doc.taxRate * 100).toFixed(0) + "%" : "（税率未知）"
    }`;
    const ship =
      doc.shippingStatus === "included"
        ? "运费已包含"
        : doc.shippingFee != null
          ? `运费 ${doc.shippingFee} ${doc.currency || base}（单独）`
          : "运费未知";
    notes.push(`  ${doc.supplier.normalizedName}：${doc.currency || base}，${tax}，${ship}`);
  }

  // 数据流 / 隐私（P1-06）
  notes.push("", "数据流说明：");
  notes.push(
    project.providerId === "bailian"
      ? "  本次使用百炼 AI 智能抽取：文件内容曾上传至阿里云百炼（DashScope）qwen-long 文档理解服务用于结构化抽取；临时文件在调用后已请求删除，不用于模型训练。"
      : "  本次使用本地规则解析：文件内容与所有计算均在浏览器本地完成，未上传任何服务器。"
  );
  return notes;
}

/** 列号（0 起）转 Excel 列字母：0→A，25→Z，26→AA */
function colLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 证据摘要（来源 + 页码 / 单元格 + 原文片段），用于导出可追溯 */
function evidenceSummary(li: LineItem): string {
  if (li.evidence.length === 0) return "无原文证据（可能为 AI 推断）";
  return li.evidence
    .map((ev) => {
      const src =
        ev.sourceType === "ai"
          ? "AI抽取"
          : ev.sourceType === "excel"
            ? "Excel"
            : ev.sourceType === "pdf"
              ? "PDF"
              : ev.sourceType === "image"
                ? "图片OCR"
                : "原文";
      const loc = ev.cell
        ? ev.sheetName
          ? `${ev.sheetName}!${ev.cell}`
          : ev.cell
        : `第${ev.page}页`;
      const text = ev.text.length > 30 ? ev.text.slice(0, 30) + "…" : ev.text;
      return `${src}·${loc}·“${text}”`;
    })
    .join("；");
}

/** 人工修改摘要（AI 原值→当前值），用于导出审计 */
function changesSummary(li: LineItem): string {
  const av = li.aiValues;
  if (!av) return "";
  const fmt = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const pairs: [string, unknown, unknown][] = [
    ["名称", av.originalName, li.originalName],
    ["规格", av.spec, li.spec],
    ["数量", av.quantity, li.quantity],
    ["单价", av.unitPrice, li.unitPrice],
    ["小计", av.subtotal, li.subtotal],
  ];
  return pairs
    .filter(([, a, b]) => fmt(a) !== fmt(b))
    .map(([label, a, b]) => `${label}:${fmt(a)}→${fmt(b)}`)
    .join("；");
}

/** 导出 Excel（使用当前页面口径，返回文件名） */
export function exportToExcel(project: ComparisonProject): string {
  const wb = XLSX.utils.book_new();
  const analyzedDocs = project.documents.filter((d) => d.analyzed !== false);
  const base = (project.baseCurrency ?? "CNY").toUpperCase();
  const ctx = { baseCurrency: base, rates: project.exchangeRates };
  const MONEY = '#,##0.00';

  // ---- Sheet 1: 原始数据（含币种 / 小计公式 / 证据 / 人工修改 / 确认） ----
  const rawHeader = [
    "供应商", "文件名", "币种", "序号", "原始名称", "规格", "品牌",
    "数量", "单位", "单价", "小计(=数量×单价)", "税率", "置信度",
    "人工修改", "原文证据", "已确认",
  ];
  const ws1 = XLSX.utils.aoa_to_sheet([rawHeader]);
  let r = 2;
  for (const doc of analyzedDocs) {
    for (const item of doc.lineItems) {
      const qty = item.quantity ?? "";
      const price = item.unitPrice ?? "";
      const subtotal =
        item.quantity != null && item.unitPrice != null
          ? { f: `ROUND(H${r}*J${r},2)`, v: Math.round(item.quantity * item.unitPrice * 100) / 100 }
          : item.subtotal ?? "";
      XLSX.utils.sheet_add_aoa(
        ws1,
        [[
          doc.supplier.normalizedName,
          doc.fileName,
          (doc.currency || base).toUpperCase(),
          item.originalIndex,
          item.originalName,
          item.spec,
          item.brand,
          qty,
          item.unit,
          price,
          subtotal,
          item.taxRate != null ? item.taxRate : "",
          item.confidence,
          changesSummary(item),
          evidenceSummary(item),
          item.userConfirmed ? "是" : "否",
        ]],
        { origin: `A${r}` }
      );
      if (typeof price === "number") ws1[`J${r}`].z = MONEY;
      if (typeof subtotal === "object") ws1[`K${r}`].z = MONEY;
      if (typeof item.taxRate === "number") ws1[`L${r}`].z = "0%";
      r++;
    }
  }
  ws1["!cols"] = [
    { wch: 16 }, { wch: 22 }, { wch: 6 }, { wch: 6 }, { wch: 26 }, { wch: 22 },
    { wch: 10 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
    { wch: 8 }, { wch: 50 }, { wch: 50 }, { wch: 8 },
  ];
  ws1["!autofilter"] = { ref: `A1:${colLetter(rawHeader.length - 1)}${Math.max(r - 1, 1)}` };
  ws1["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  XLSX.utils.book_append_sheet(wb, ws1, "原始数据");

  // ---- Sheet 2: 横向对比（仅组成员取值；原币 + 基准币；最低价公式） ----
  const fixedL = ["标准名称", "规格", "匹配状态", "组成员数"];
  const supplierNames = analyzedDocs.map((d) => `${d.supplier.normalizedName}(${(d.currency || base).toUpperCase()})`);
  const tailL = ["最低可比价(基准币)", "可比总价说明", "组确认"];
  const header2 = [...fixedL, ...supplierNames, ...tailL];
  const ws2 = XLSX.utils.aoa_to_sheet([header2]);
  const firstCol = fixedL.length;
  const lastCol = firstCol + analyzedDocs.length - 1;
  let rr = 2;
  for (const mg of project.matchGroups) {
    const memberCount = mg.lineItemIds.length;
    const rowArr: (string | number | { f: string; v: number })[] = [
      mg.normalizedName,
      mg.normalizedSpec,
      matchStatusLabel(mg.status),
      memberCount,
    ];
    const memberPrices: number[] = [];
    for (const doc of analyzedDocs) {
      const li = doc.lineItems.find((l) => mg.lineItemIds.includes(l.id));
      if (!li) {
        rowArr.push(""); // 非组成员：留空，不填值（P0-01）
        continue;
      }
      const p = getComparablePrice(li, doc, project.taxMode, project.includeShipping, ctx);
      if (p != null) {
        rowArr.push(p);
        memberPrices.push(p);
      } else if (isFxPending(doc, ctx)) {
        rowArr.push("汇率待确认");
      } else if (isTaxRatePending(doc, project.taxMode)) {
        rowArr.push("税率待确认");
      } else {
        rowArr.push("缺失");
      }
    }
    // P2-02 第五轮：单一成员（独有项）无横向比较对象，不计算最低可比价
    const minCell =
      memberPrices.length >= 2
        ? { f: `MIN(${colLetter(firstCol)}${rr}:${colLetter(lastCol)}${rr})`, v: Math.min(...memberPrices) }
        : "—";
    rowArr.push(minCell);
    rowArr.push(
      memberPrices.length >= 2
        ? "组内可比"
        : memberPrices.length === 1
          ? "独有项目，不参与最低价比较"
          : "无可比价"
    );
    rowArr.push(mg.userConfirmed ? "是" : "否");
    XLSX.utils.sheet_add_aoa(ws2, [rowArr], { origin: `A${rr}` });
    for (let c = firstCol; c <= lastCol; c++) {
      const cell = ws2[`${colLetter(c)}${rr}`];
      if (cell && typeof cell.v === "number") cell.z = MONEY;
    }
    if (typeof minCell === "object") ws2[`${colLetter(lastCol + 1)}${rr}`].z = MONEY;
    rr++;
  }
  ws2["!cols"] = [
    { wch: 24 }, { wch: 52 }, { wch: 10 }, { wch: 9 },
    ...analyzedDocs.map(() => ({ wch: 22 })),
    { wch: 16 }, { wch: 26 }, { wch: 8 },
  ];
  ws2["!autofilter"] = { ref: `A1:${colLetter(header2.length - 1)}${Math.max(rr - 1, 1)}` };
  ws2["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  XLSX.utils.book_append_sheet(wb, ws2, "横向对比");

  // ---- Sheet 3: 可比总价（按报价口径 + 已确认汇率） ----
  const incomparable = hasIncomparableItems(project);
  const totalHeader = ["供应商", "币种", "报价总价(原币)", "可比总价(基准币)", "共同项目小计(基准币)", "状态说明"];
  const ws4 = XLSX.utils.aoa_to_sheet([totalHeader]);
  let tr = 2;
  for (const doc of analyzedDocs) {
    const c = (doc.currency || base).toUpperCase();
    const ct = incomparable ? null : comparableTotal(doc, project.taxMode, project.includeShipping, ctx);
    const cis = commonItemsSubtotal(doc, project, project.taxMode, project.includeShipping, ctx);
    let note = "可比";
    if (incomparable) {
      note = "存在不同配置独有项，整单不可比";
    } else if (ct == null) {
      note = isFxPending(doc, ctx)
        ? "汇率未确认，不可比"
        : isTaxRatePending(doc, project.taxMode)
          ? "税率缺失，不可比"
          : doc.shippingStatus === "unknown"
            ? "运费未知，不可比"
            : "不可比";
    }
    XLSX.utils.sheet_add_aoa(
      ws4,
      [[doc.supplier.normalizedName, c, doc.totalPrice ?? "", ct ?? "", cis ?? "", note]],
      { origin: `A${tr}` }
    );
    if (typeof doc.totalPrice === "number") ws4[`C${tr}`].z = MONEY;
    if (typeof ct === "number") ws4[`D${tr}`].z = MONEY;
    if (typeof cis === "number") ws4[`E${tr}`].z = MONEY;
    tr++;
  }
  ws4["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 28 }];
  ws4["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  XLSX.utils.book_append_sheet(wb, ws4, "可比总价");

  // ---- Sheet 4: 汇率 ----
  const rateHeader = ["币种", `对${base}汇率`, "确认状态", "日期", "来源"];
  const ws5 = XLSX.utils.aoa_to_sheet([rateHeader]);
  const rates = project.exchangeRates ?? {};
  let xr = 2;
  for (const c of Object.keys(rates)) {
    const rt = rates[c];
    XLSX.utils.sheet_add_aoa(
      ws5,
      [[c, rt.rate, rt.confirmed ? "已确认" : "待确认", rt.date ?? "", rt.source ?? ""]],
      { origin: `A${xr}` }
    );
    ws5[`B${xr}`].z = "0.0000";
    xr++;
  }
  if (Object.keys(rates).length === 0) {
    XLSX.utils.sheet_add_aoa(ws5, [["—", "", "全部为基准币", "", ""]], { origin: "A2" });
  }
  ws5["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws5, "汇率");

  // ---- Sheet 5: 异常与待确认 ----
  const anoRows = project.anomalies.map((a) => ({
    类型: a.type,
    严重度: a.severity,
    描述: a.message,
    期望值: a.expected ?? "",
    实际值: a.actual ?? "",
  }));
  const ws3 = XLSX.utils.json_to_sheet(anoRows);
  ws3["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 56 }, { wch: 12 }, { wch: 12 }];
  if (anoRows.length > 0) ws3["!autofilter"] = { ref: `A1:E${anoRows.length + 1}` };
  XLSX.utils.book_append_sheet(wb, ws3, "异常与待确认");

  // ---- Sheet 6: 审计轨迹（第七轮 P2：长文本完整不截断 + 证据精确定位） ----
  const auditHeader = [
    "供应商", "文件名", "序号", "当前名称", "完整规格",
    "AI原值→当前值(完整)", "证据来源", "证据定位", "证据原文(完整)",
  ];
  const auditRows: string[][] = [];
  for (const doc of analyzedDocs) {
    for (const item of doc.lineItems) {
      const ev0 = item.evidence[0];
      const src = ev0
        ? ev0.sourceType === "ai"
          ? "AI抽取"
          : ev0.sourceType === "excel"
            ? "Excel"
            : ev0.sourceType === "pdf"
              ? "PDF"
              : ev0.sourceType === "image"
                ? "图片OCR"
                : "原文"
        : "无";
      const loc = ev0
        ? ev0.cell
          ? ev0.sheetName
            ? `${ev0.sheetName}!${ev0.cell}`
            : ev0.cell
          : `第${ev0.page}页`
        : "";
      auditRows.push([
        doc.supplier.normalizedName,
        doc.fileName,
        String(item.originalIndex),
        item.originalName,
        item.spec,
        changesSummary(item) || "无修改",
        src,
        loc,
        item.evidence.map((e) => e.text).join("；"),
      ]);
    }
  }
  const wsAudit = XLSX.utils.aoa_to_sheet([auditHeader, ...auditRows]);
  wsAudit["!cols"] = [
    { wch: 16 }, { wch: 22 }, { wch: 6 }, { wch: 34 }, { wch: 60 },
    { wch: 70 }, { wch: 10 }, { wch: 22 }, { wch: 70 },
  ];
  wsAudit["!autofilter"] = { ref: `A1:I${Math.max(auditRows.length + 1, 1)}` };
  wsAudit["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  XLSX.utils.book_append_sheet(wb, wsAudit, "审计轨迹");

  // ---- Sheet 7: 口径说明 ----
  const noteWs = XLSX.utils.aoa_to_sheet([
    ["口径与假设说明"],
    ...caliberNotes(project).map((n) => [n]),
  ]);
  noteWs["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, noteWs, "口径说明");

  const fileName = `${project.name}_对比结果.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

/** 导出 CSV（使用当前页面口径，返回文件名） */
export function exportToCSV(project: ComparisonProject): string {
  const analyzedDocs = project.documents.filter((d) => d.analyzed !== false);
  const base = (project.baseCurrency ?? "CNY").toUpperCase();
  const ctx = { baseCurrency: base, rates: project.exchangeRates };
  const rows: string[] = [];
  const suppliers = analyzedDocs.map(
    (d) => `${d.supplier.normalizedName}(${(d.currency || base).toUpperCase()})`
  );
  const taxLabel =
    project.taxMode === "inclusive" ? "含税" : project.taxMode === "exclusive" ? "未税" : "原始";
  rows.push(
    `# 价格口径：${taxLabel}；运费：${project.includeShipping ? "含分摊" : "不含"}；基准币：${base}`
  );
  rows.push(["项目", "规格", ...suppliers.map((s) => s + "_单价"), "最低可比价"].join(","));

  for (const mg of project.matchGroups) {
    const prices: (number | null)[] = [];
    const cells = [mg.normalizedName, mg.normalizedSpec];
    for (const doc of analyzedDocs) {
      const li = doc.lineItems.find((l) => mg.lineItemIds.includes(l.id));
      const p = li
        ? getComparablePrice(li, doc, project.taxMode, project.includeShipping, ctx)
        : null;
      prices.push(p);
      cells.push(p != null ? String(p) : li ? "待确认" : "");
    }
    const valid = prices.filter((p): p is number => p != null);
    const min = valid.length > 0 ? Math.min(...valid) : null;
    cells.push(min != null ? String(min) : "");
    rows.push(cells.join(","));
  }

  const blob = new Blob(["\uFEFF" + rows.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fileName = `${project.name}_对比.csv`;
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return fileName;
}

// ============================================================
// 项目组装（真实抽取与演示回退共用）
// ============================================================

/**
 * 通用匹配分组：跨供应商按类别 + 规格归组，硬冲突隔离。
 * 实现位于 quote-match.ts（本地确定性匹配引擎）；
 * 此处再套一层 enforceSpecIsolation 作为安全网。
 */
export function buildMatchGroups(documents: QuoteDocument[]): MatchGroup[] {
  return enforceSpecIsolation(buildMatchGroupsLocal(documents), documents);
}

/** 由结构化文档组装完整对比项目（自动生成分组与异常） */
export function assembleProject(
  documents: QuoteDocument[],
  opts?: {
    name?: string;
    demoMode?: boolean;
    projectId?: string;
    providerId?: string;
    /** 预计算的匹配组（如 AI 聚类结果）；缺省则走本地匹配 */
    matchGroups?: MatchGroup[];
    baseCurrency?: string;
  }
): ComparisonProject {
  const projectId = opts?.projectId ?? `proj-${Date.now()}`;
  const docs = documents.map((d) => ({ ...d, projectId }));
  const baseCurrency = (opts?.baseCurrency ?? "CNY").toUpperCase();
  const project: ComparisonProject = {
    id: projectId,
    name: opts?.name ?? "报价比价项目",
    status: "comparing",
    currency: baseCurrency,
    baseCurrency,
    taxMode: "original",
    includeShipping: false,
    documents: docs,
    matchGroups: opts?.matchGroups
      ? enforceSpecIsolation(opts.matchGroups, docs)
      : buildMatchGroups(docs),
    anomalies: [],
    createdAt: new Date().toISOString(),
    demoMode: opts?.demoMode,
    providerId: opts?.providerId,
    exchangeRates: seedExchangeRates(docs, baseCurrency),
  };
  project.anomalies = detectAnomalies(project);
  return project;
}
