// ============================================================
// 报价齐 · 规则抽取提供器（默认）
// ------------------------------------------------------------
// 真实读取文件内容：
//  - Excel：xlsx 解析为表格行 → 定位表头 → 逐行结构化
//  - PDF：pdfjs 提取文本行 → 启发式还原表格行
// 输出结构化报价单草稿。解析逻辑为纯函数，便于单元测试。
// 说明：规则解析为启发式，复杂版式可能不完整，用户可在「抽取复核」
//       中编辑修正；接入 AI 提供器后可获得更高质量结果。
// ============================================================

import type { LineItem, FileType } from "../quote-types";
import type {
  DraftDocument,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
} from "./types";
import { readXlsxRows, locateTextInWorkbook } from "./parse-xlsx";
import { readPdfText } from "./parse-pdf";

// ------------------------------------------------------------
// 基础工具（导出供测试）
// ------------------------------------------------------------
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 解析数字：去除货币符号 / 千分位 / 单位后缀，取首个数值 */
export function parseNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/[¥￥$€,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** 标准化名称：去空格 / 标点 / 小写，用于跨供应商匹配 */
export function normalizeName(s: string): string {
  return s.replace(/[\s\p{P}]/gu, "").toLowerCase();
}

// ------------------------------------------------------------
// 中间结构
// ------------------------------------------------------------
export interface ParsedItem {
  originalName: string;
  spec: string;
  brand: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  subtotal: number | null;
  sourceText: string;
  /** 在清洗后表格中的行号（0 起，Excel 用，用于生成单元格引用） */
  rowIndex?: number;
}

export interface ParsedQuote {
  supplierName: string | null;
  quoteDate: string | null;
  validUntil: string | null;
  taxInclusive: boolean | null;
  taxRate: number | null;
  totalPrice: number | null;
  shippingFee: number | null;
  shippingStatus: "included" | "separate" | "unknown";
  deliveryDays: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  items: ParsedItem[];
}

function emptyParsedQuote(): ParsedQuote {
  return {
    supplierName: null,
    quoteDate: null,
    validUntil: null,
    taxInclusive: null,
    taxRate: null,
    totalPrice: null,
    shippingFee: null,
    shippingStatus: "unknown",
    deliveryDays: null,
    paymentTerms: null,
    warranty: null,
    items: [],
  };
}

// ------------------------------------------------------------
// 字段识别正则
// ------------------------------------------------------------
const NAME_RE = /名称|品名|品目|商品|产品|物料|货物|设备/;
const SPEC_RE = /规格|型号|参数|尺寸|规格型号/;
const BRAND_RE = /品牌|厂牌|牌子/;
const QTY_RE = /数量|数目/;
const UNIT_RE = /单位/;
const PRICE_RE = /单价|价格/;
const AMOUNT_HEAD_RE = /金额|小计|合价/;
const HEADER_ROW_RE = /名称|品名|品目|商品|产品|物料|货物|设备/;

const pad = (s: string) => s.padStart(2, "0");

/** 识别供应商名称：抽取以公司后缀结尾的完整连续 token */
export function detectSupplier(lines: string[]): string | null {
  const COMPANY_SUFFIX = /(有限公司|公司|集团|商行|经营部|销售部|商贸|实业|银行|工厂|厂)$/;
  for (const l of lines.slice(0, 10)) {
    const tokens = l.match(/[\u4e00-\u9fa5A-Za-z0-9（）()]+/g) ?? [];
    // 优先取以「公司 / 有限公司」结尾的完整名称
    for (const t of tokens) {
      if (/(有限公司|公司)$/.test(t) && t.length >= 4) return t;
    }
    for (const t of tokens) {
      if (COMPANY_SUFFIX.test(t) && t.length >= 3) return t;
    }
  }
  return null;
}

/** 识别日期：优先取「标签之后」的第一个日期，避免同行多日期误取 */
export function detectDate(lines: string[], labelRe: RegExp): string | null {
  const dateRe = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/;
  const fmt = (m: RegExpMatchArray) => `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  for (const l of lines) {
    const lm = l.match(labelRe);
    if (lm && lm.index != null) {
      const after = l.slice(lm.index + lm[0].length);
      const m = after.match(dateRe);
      if (m) return fmt(m);
    }
  }
  for (const l of lines) {
    const m = l.match(dateRe);
    if (m) return fmt(m);
  }
  return null;
}

/** 识别税费口径 */
export function detectTax(text: string): { taxInclusive: boolean | null; taxRate: number | null } {
  let taxInclusive: boolean | null = null;
  if (/不含税|未税|税前|不含税额/.test(text)) taxInclusive = false;
  else if (/含税|价税|税价|含13|增值税/.test(text)) taxInclusive = true;

  let taxRate: number | null = null;
  const m =
    text.match(/(?:税率|税额|税)\s*[:：]?\s*(\d{1,2})\s*%/) ||
    text.match(/(\d{1,2})\s*%/);
  if (m) {
    const r = parseInt(m[1], 10);
    if ([0, 1, 3, 6, 9, 13].includes(r)) taxRate = r / 100;
  }
  return { taxInclusive, taxRate };
}

// ------------------------------------------------------------
// Excel 行 → 结构化
// ------------------------------------------------------------
interface HeaderInfo {
  index: number;
  nameCol: number;
  specCol: number;
  brandCol: number;
  qtyCol: number;
  unitCol: number;
  priceCol: number;
  amountCol: number;
}

function findCol(row: string[], re: RegExp): number {
  return row.findIndex((c) => re.test(c));
}

export function findHeader(rows: string[][]): HeaderInfo | null {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const hasName = row.some((c) => HEADER_ROW_RE.test(c));
    const hasNumCol = row.some((c) => QTY_RE.test(c) || PRICE_RE.test(c) || AMOUNT_HEAD_RE.test(c));
    if (hasName && hasNumCol) {
      return {
        index: i,
        nameCol: findCol(row, NAME_RE),
        specCol: findCol(row, SPEC_RE),
        brandCol: findCol(row, BRAND_RE),
        qtyCol: findCol(row, QTY_RE),
        unitCol: findCol(row, UNIT_RE),
        priceCol: findCol(row, PRICE_RE),
        amountCol: findCol(row, AMOUNT_HEAD_RE),
      };
    }
  }
  return null;
}

function firstNum(row: string[]): number | null {
  for (const c of row) {
    const n = parseNum(c);
    if (n != null) return n;
  }
  return null;
}

export function structureFromRows(rows: string[][]): ParsedQuote {
  const cleaned = rows.filter((r) => r.some((c) => c !== ""));
  const pq = emptyParsedQuote();
  const allText = cleaned.map((r) => r.join(" "));
  const joinedAll = allText.join("\n");

  pq.supplierName = detectSupplier(allText);
  pq.quoteDate = detectDate(allText, /日期|报价日|开单|制单/);
  pq.validUntil = detectDate(allText, /有效期|报价有效期|截至/);
  const tax = detectTax(joinedAll);
  pq.taxInclusive = tax.taxInclusive;
  pq.taxRate = tax.taxRate;

  const dm = joinedAll.match(/(?:交期|交货|发货|货期)\s*[:：]?\s*(\d{1,3})\s*天/);
  if (dm) pq.deliveryDays = parseInt(dm[1], 10);
  const pm = joinedAll.match(/(?:付款|账期|结算|月结)[^\n]{0,12}/);
  if (pm) pq.paymentTerms = pm[0].trim();
  const wm = joinedAll.match(/(?:质保|保修|包换|售后)[^\n]{0,16}/);
  if (wm) pq.warranty = wm[0].trim();

  const header = findHeader(cleaned);
  if (!header) {
    // 无明确表头：退化为文本行解析
    pq.items = parseTextLines(allText).items;
    return pq;
  }

  const cols = header;
  for (let r = cols.index + 1; r < cleaned.length; r++) {
    const row = cleaned[r];
    const joined = row.join(" ");
    const nameCell = cols.nameCol >= 0 ? (row[cols.nameCol] ?? "").trim() : "";

    // 运费行
    if (/运费|邮费|快递费|配送费/.test(joined)) {
      pq.shippingFee = firstNum(row);
      pq.shippingStatus =
        pq.shippingFee != null && pq.shippingFee > 0 ? "separate" : "included";
      continue;
    }
    // 合计 / 总价行（名称列为空，或名称列本身就是合计标签）
    if (
      /合计|总计|总价|总金额|价税合计/.test(joined) &&
      (nameCell === "" || /合计|总计|总价|总金额|价税合计/.test(nameCell))
    ) {
      const amt = cols.amountCol >= 0 ? parseNum(row[cols.amountCol]) : null;
      pq.totalPrice = amt ?? firstNum(row);
      continue;
    }
    if (!nameCell) continue;
    // 重复表头
    if (HEADER_ROW_RE.test(nameCell) && (QTY_RE.test(joined) || PRICE_RE.test(joined))) continue;

    const quantity = cols.qtyCol >= 0 ? parseNum(row[cols.qtyCol]) : null;
    const unitPrice = cols.priceCol >= 0 ? parseNum(row[cols.priceCol]) : null;
    let subtotal = cols.amountCol >= 0 ? parseNum(row[cols.amountCol]) : null;
    if (subtotal == null && quantity != null && unitPrice != null) {
      subtotal = round2(quantity * unitPrice);
    }

    pq.items.push({
      originalName: nameCell,
      spec: cols.specCol >= 0 ? (row[cols.specCol] ?? "").trim() : "",
      brand: cols.brandCol >= 0 ? (row[cols.brandCol] ?? "").trim() : "",
      quantity,
      unit: cols.unitCol >= 0 ? (row[cols.unitCol] ?? "").trim() : "",
      unitPrice,
      subtotal,
      sourceText: joined,
      rowIndex: r,
    });
  }
  return pq;
}

// ------------------------------------------------------------
// PDF 文本行 → 结构化（启发式：尾部连续数字视为 数量/单价/金额）
// ------------------------------------------------------------
export function parseTextLines(lines: string[]): ParsedQuote {
  const pq = emptyParsedQuote();
  for (const line of lines) {
    if (/合计|总计|总价|小计|运费|税额|备注|联系人|电话/.test(line)) continue;
    const tokens = line.split(/\s+/).filter(Boolean);
    // 收集尾部连续数字 token
    const nums: { i: number; v: number }[] = [];
    for (let i = tokens.length - 1; i >= 0; i--) {
      const raw = tokens[i].replace(/[¥￥,]/g, "");
      if (/^-?\d+(\.\d+)?$/.test(raw)) {
        const v = parseNum(tokens[i]);
        if (v != null) nums.unshift({ i, v });
      } else break;
    }
    if (nums.length < 2) continue;
    const name = tokens.slice(0, nums[0].i).join(" ").trim();
    if (!name || /^[\d.]+$/.test(name)) continue;
    // 跳过表头行
    if (HEADER_ROW_RE.test(name) && (QTY_RE.test(line) || PRICE_RE.test(line))) continue;

    const vals = nums.map((n) => n.v);
    let quantity: number | null = null;
    let unitPrice: number | null = null;
    let subtotal: number | null = null;
    if (vals.length >= 3) {
      quantity = vals[vals.length - 3];
      unitPrice = vals[vals.length - 2];
      subtotal = vals[vals.length - 1];
    } else {
      unitPrice = vals[vals.length - 2];
      subtotal = vals[vals.length - 1];
    }
    pq.items.push({
      originalName: name,
      spec: "",
      brand: "",
      quantity,
      unit: "",
      unitPrice,
      subtotal,
      sourceText: line,
    });
  }
  return pq;
}

export function structureFromPdfLines(lines: string[]): ParsedQuote {
  const pq = parseTextLines(lines);
  pq.supplierName = detectSupplier(lines);
  pq.quoteDate = detectDate(lines, /日期|报价日|开单|制单/);
  pq.validUntil = detectDate(lines, /有效期|报价有效期|截至/);
  const tax = detectTax(lines.join("\n"));
  pq.taxInclusive = tax.taxInclusive;
  pq.taxRate = tax.taxRate;
  // 总价 / 运费
  for (const line of lines) {
    if (/运费|邮费|快递费|配送费/.test(line)) {
      pq.shippingFee = parseNum(line.replace(/.*?(运费|邮费|快递费|配送费)/, ""));
      pq.shippingStatus = pq.shippingFee != null && pq.shippingFee > 0 ? "separate" : "included";
    } else if (/合计|总计|总价|总金额|价税合计/.test(line)) {
      pq.totalPrice = parseNum(line.replace(/.*?(合计|总计|总价|总金额|价税合计)/, ""));
    }
  }
  return pq;
}

// ------------------------------------------------------------
// 草稿组装
// ------------------------------------------------------------
function guessSupplierFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/报价单?|报价表?| quotation|quote/gi, "").trim();
  return cleaned || "未知供应商";
}

interface BuildMeta {
  pageCount: number;
  hasTextLayer: boolean;
  qualityStatus: "pass" | "warning" | "fail";
  qualityNotes: string[];
  confidence: "high" | "medium" | "low";
}

function buildDraft(input: ExtractionInput, pq: ParsedQuote, meta: BuildMeta): DraftDocument {
  const supplierName = pq.supplierName ?? guessSupplierFromFileName(input.fileName);
  // 有效期若与报价日相同（多为无标签回退误取），视为未识别
  const validUntil =
    pq.validUntil && pq.validUntil !== pq.quoteDate ? pq.validUntil : null;
  const ft = input.fileType as FileType;
  const sourceType: "pdf" | "excel" | "image" =
    ft === "xlsx" || ft === "xls" ? "excel" : ft === "pdf" ? "pdf" : "image";
  const basisBySource: Record<typeof sourceType, string> = {
    excel: "Excel 单元格经表头规则结构化",
    pdf: "PDF 文本层经行启发式还原",
    image: "图片无文本层，需 OCR / 人工录入",
  };
  const lineItems: LineItem[] = pq.items.map((it, idx) => {
    // 优先精确定位工作表 + 单元格区域；失败时退回行号描述
    const loc =
      sourceType === "excel" ? locateTextInWorkbook(input.data, it.originalName) : null;
    const cell =
      loc?.cell ??
      (sourceType === "excel" && it.rowIndex != null
        ? `第 ${it.rowIndex + 1} 行`
        : undefined);
    const sheetName = loc?.sheetName;
    const values = {
      originalName: it.originalName,
      spec: it.spec,
      brand: it.brand,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      subtotal: it.subtotal,
      taxRate: pq.taxRate,
    };
    return {
      id: `li-${idx + 1}`,
      docId: "",
      originalIndex: idx + 1,
      originalName: it.originalName,
      normalizedName: normalizeName(it.originalName),
      spec: it.spec,
      brand: it.brand,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      subtotal: it.subtotal,
      taxRate: pq.taxRate,
      deliveryDays: pq.deliveryDays,
      remark: "",
      confidence: meta.confidence,
      evidence: [
        {
          fileId: "",
          page: 1,
          text: it.sourceText,
          sourceType,
          sheetName,
          cell,
          basis: basisBySource[sourceType],
        },
      ],
      userConfirmed: false,
      aiValues: values,
    };
  });

  return {
    fileName: input.fileName,
    fileType: input.fileType as FileType,
    fileSize: input.fileSize,
    pageCount: meta.pageCount,
    hasTextLayer: meta.hasTextLayer,
    qualityStatus: meta.qualityStatus,
    qualityNotes: meta.qualityNotes,
    analyzed: true,
    supplier: {
      id: "",
      originalName: supplierName,
      normalizedName: normalizeName(supplierName),
    },
    quoteDate: pq.quoteDate,
    validUntil,
    currency: "CNY",
    taxInclusive: pq.taxInclusive,
    taxRate: pq.taxRate,
    totalPrice: pq.totalPrice,
    shippingFee: pq.shippingFee,
    shippingStatus: pq.shippingStatus,
    deliveryDays: pq.deliveryDays,
    paymentTerms: pq.paymentTerms,
    warranty: pq.warranty,
    lineItems,
    fieldConfidence: {},
  };
}

// ------------------------------------------------------------
// 提供器实现
// ------------------------------------------------------------
export const ruleProvider: ExtractionProvider = {
  id: "rule",
  label: "本地规则解析",
  description:
    "使用 pdfjs / xlsx 真实读取文件内容并按表格规则结构化，无需联网与密钥；复杂版式可在复核中修正。",
  serverOnly: false,

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    try {
      if (input.fileType === "xlsx" || input.fileType === "xls") {
        const rows = readXlsxRows(input.data);
        if (!rows.length) {
          return {
            document: buildDraft(input, emptyParsedQuote(), {
              pageCount: 1,
              hasTextLayer: true,
              qualityStatus: "warning",
              qualityNotes: ["未读取到任何单元格内容"],
              confidence: "low",
            }),
            providerId: "rule",
            parsed: false,
          };
        }
        const pq = structureFromRows(rows);
        return {
          document: buildDraft(input, pq, {
            pageCount: 1,
            hasTextLayer: true,
            qualityStatus: "pass",
            qualityNotes: [],
            confidence: "medium",
          }),
          rawText: rows.map((r) => r.join("\t")).join("\n"),
          providerId: "rule",
          parsed: true,
        };
      }

      if (input.fileType === "pdf") {
        const { pageCount, hasTextLayer, lines } = await readPdfText(input.data);
        if (!hasTextLayer) {
          return {
            document: buildDraft(input, emptyParsedQuote(), {
              pageCount,
              hasTextLayer: false,
              qualityStatus: "warning",
              qualityNotes: ["PDF 无文本层（可能为扫描件），需 OCR 或人工录入"],
              confidence: "low",
            }),
            providerId: "rule",
            parsed: false,
          };
        }
        const pq = structureFromPdfLines(lines);
        return {
          document: buildDraft(input, pq, {
            pageCount,
            hasTextLayer: true,
            qualityStatus: "pass",
            qualityNotes: [],
            confidence: "low",
          }),
          rawText: lines.join("\n"),
          providerId: "rule",
          parsed: true,
        };
      }

      // jpg / png / 其他：本地规则解析不支持
      return {
        document: buildDraft(input, emptyParsedQuote(), {
          pageCount: 1,
          hasTextLayer: false,
          qualityStatus: "warning",
          qualityNotes: ["图片格式需 OCR，本地规则解析不支持；请人工录入或接入 AI 提供器"],
          confidence: "low",
        }),
        providerId: "rule",
        parsed: false,
      };
    } catch (e) {
      return {
        document: buildDraft(input, emptyParsedQuote(), {
          pageCount: 0,
          hasTextLayer: false,
          qualityStatus: "fail",
          qualityNotes: [`解析失败：${(e as Error).message}`],
          confidence: "low",
        }),
        providerId: "rule",
        parsed: false,
      };
    }
  },
};
