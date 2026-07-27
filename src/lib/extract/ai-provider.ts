// ============================================================
// 报价齐 · AI 抽取提供器（阿里云百炼 qwen-long 文档理解）
// ------------------------------------------------------------
// 「可插拔框架」中的大模型提供器。流程：
//  1. 通过 OpenAI 兼容接口将文件上传至百炼（purpose=file-extract），
//     取得 file-fe-xxx 文件 ID（支持 PDF / XLSX / 图片 / 扫描件）；
//  2. 以 fileid:// 方式调用 qwen-long 多模态长文档理解，
//     prompt 要求严格输出结构化 JSON；
//  3. 解析模型返回的 JSON，映射为 DraftDocument（复用 rule-provider
//     的 normalizeName 保证跨提供器口径一致）；
//  4. 抽取完成后尽力删除临时上传文件（best-effort）。
// 需要服务端环境变量 DASHSCOPE_API_KEY；会产生模型调用费用。
// ============================================================

import type { FileType, LineItem } from "../quote-types";
import type {
  DraftDocument,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
} from "./types";
import { normalizeName } from "./rule-provider";
import { locateTextInWorkbook } from "./parse-xlsx";

// ------------------------------------------------------------
// 配置
// ------------------------------------------------------------
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen-long";
/** 单次抽取超时（毫秒）：文档理解可能较慢 */
const REQUEST_TIMEOUT_MS = 120_000;

function getBaseUrl(): string {
  return (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getModel(): string {
  return process.env.BAILIAN_MODEL || DEFAULT_MODEL;
}

/** 是否已配置百炼密钥 */
export function isBailianConfigured(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

function mimeFor(fileType: FileType): string {
  switch (fileType) {
    case "pdf":
      return "application/pdf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

// ------------------------------------------------------------
// Prompt
// ------------------------------------------------------------
const SYSTEM_INSTRUCTIONS = [
  "你是一名专业的采购报价单结构化抽取专家。",
  "你将收到一份报价单文件（可能是 PDF、Excel 或图片）。请仔细阅读文件全部内容，抽取供应商报价信息，并严格以 JSON 对象输出。",
  "要求：",
  "1. 只输出一个 JSON 对象，不要任何解释文字，不要使用 Markdown 代码块。",
  "2. 金额、数量、单价均为纯数字（不含货币符号、千分位逗号或单位）；无法确定时填 null。",
  "3. 日期统一为 YYYY-MM-DD 格式。",
  "4. taxRate 以小数表示（例如 13% 输出 0.13，3% 输出 0.03）。",
  "5. shippingStatus：运费已含在总价中填 included，运费单列填 separate，无法判断填 unknown。",
  "6. 不要编造文件中不存在的信息；任何不确定的字段一律填 null。",
  "7. items 需包含文件中全部报价行项目，不要遗漏，也不要添加文件中没有的项目。",
].join("\n");

const USER_PROMPT = [
  "请抽取该报价单，并严格按以下 JSON 结构输出（字段名保持英文）：",
  "{",
  '  "supplierName": "供应商公司全称",',
  '  "contact": "联系人或null",',
  '  "phone": "联系电话或null",',
  '  "quoteDate": "报价日期YYYY-MM-DD或null",',
  '  "validUntil": "报价有效期YYYY-MM-DD或null",',
  '  "currency": "币种，如CNY",',
  '  "taxInclusive": "true/false/null 是否含税",',
  '  "taxRate": "税率小数或null",',
  '  "totalPrice": "总价数字或null",',
  '  "shippingFee": "运费数字或null",',
  '  "shippingStatus": "included/separate/unknown",',
  '  "deliveryDays": "交货天数数字或null",',
  '  "paymentTerms": "付款条件或null",',
  '  "warranty": "质保条款或null",',
  '  "items": [',
  '    {"name":"名称","spec":"规格型号","brand":"品牌","quantity":数量,"unit":"单位","unitPrice":单价,"subtotal":小计,"remark":"备注"}',
  "  ]",
  "}",
].join("\n");

// ------------------------------------------------------------
// 模型输出结构（宽松，字段均可缺省）
// ------------------------------------------------------------
interface AiItem {
  name?: unknown;
  spec?: unknown;
  brand?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  subtotal?: unknown;
  remark?: unknown;
}

interface AiQuote {
  supplierName?: unknown;
  contact?: unknown;
  phone?: unknown;
  quoteDate?: unknown;
  validUntil?: unknown;
  currency?: unknown;
  taxInclusive?: unknown;
  taxRate?: unknown;
  totalPrice?: unknown;
  shippingFee?: unknown;
  shippingStatus?: unknown;
  deliveryDays?: unknown;
  paymentTerms?: unknown;
  warranty?: unknown;
  items?: unknown;
}

// ------------------------------------------------------------
// 归一化工具（纯函数，导出供测试）
// ------------------------------------------------------------
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 将任意值安全转为数字；非法返回 null */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  const cleaned = String(v).replace(/[¥￥$€,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? round2(n) : null;
}

/** 安全转字符串（空值返回 ""） */
function toStr(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "null" || s === "undefined" ? "" : s;
}

/** 安全转可空字符串（空值返回 null） */
function toNullableStr(v: unknown): string | null {
  const s = toStr(v);
  return s === "" ? null : s;
}

/** 归一化税率：兼容小数(0.13)与百分数(13)两种写法 */
export function normalizeTaxRate(v: unknown): number | null {
  const n = toNum(v);
  if (n == null) return null;
  if (n > 1 && n <= 100) return round2(n / 100);
  if (n >= 0 && n <= 1) return n;
  return null;
}

/** 归一化布尔（兼容字符串 "true"/"含税" 等） */
function toBool(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "1", "含税", "是"].includes(s)) return true;
  if (["false", "no", "0", "不含税", "未税", "否"].includes(s)) return false;
  return null;
}

function guessSupplierFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/报价单?|报价表?|quotation|quote/gi, "").trim();
  return cleaned || "未知供应商";
}

/**
 * 检测 OCR 断词伪影（P2-02）：如 "HDM I"、"W i-F i"、"Sw itch"、"W ire less"。
 * 启发式：存在「1–2 字符的短碎片」与相邻「≤5 字符短 token」仅隔单个空格。
 * 正常多词名称（如 "A4 Copy Paper"）的相邻 token 较长，不会误报；中文不受影响。
 * 误报只会触发「降为中置信度 + 人工复核」，不阻断流程，故可略偏敏感。
 */
export function hasOcrArtifact(s: string): boolean {
  const t = s.split(" ");
  const isWord = (x: string) => x.length > 0 && /^[A-Za-z0-9/-]+$/.test(x);
  // OCR 断词碎片：1–2 个「纯字母」（或带连字符）；A4/14+ 等含数字的型号不算
  const isSplinter = (x: string) =>
    x.length >= 1 && x.length <= 2 && /^[A-Za-z-]+$/.test(x);
  for (let i = 0; i < t.length; i++) {
    if (!isSplinter(t[i])) continue;
    const prevShort = i > 0 && isWord(t[i - 1]) && t[i - 1].length <= 4;
    const nextShort =
      i < t.length - 1 && isWord(t[i + 1]) && t[i + 1].length <= 4;
    if (prevShort || nextShort) return true;
  }
  return false;
}

// ------------------------------------------------------------
// OCR 断词修复（P2-4 第三轮）
// ------------------------------------------------------------
/** 常见被 OCR 拆断的科技 / 办公术语（小写、去空格 / 连字符后比对） */
const OCR_KNOWN_TERMS: Record<string, string> = {
  hdmi: "HDMI",
  wifi: "Wi-Fi",
  wifix: "Wi-Fi",
  bluetooth: "Bluetooth",
  switch: "Switch",
  wireless: "Wireless",
  ethernet: "Ethernet",
  usb: "USB",
  typec: "Type-C",
  vga: "VGA",
  dvi: "DVI",
  displayport: "DisplayPort",
  thunderbolt: "Thunderbolt",
  keyboard: "Keyboard",
  monitor: "Monitor",
  printer: "Printer",
  scanner: "Scanner",
  router: "Router",
  adapter: "Adapter",
  connector: "Connector",
  usbc: "USB-C",
};

/**
 * 字符级断词合并（第六轮 P2-01）：按词典构造允许字符间空格 / 连字符的正则，
 * 不依赖 token 结构，可处理 "HDM I+DP"、"D isplay Port"、"U SB-C" 等粘连情形。
 * 保守约束：命中片段必须含空格（排除正常写法）且含大写字母（排除英文句子误报）。
 */
function repairByCharMerge(s: string): string {
  let out = s;
  // 长词优先，避免短词提前吃掉长词的一部分（如 usb vs usbc）
  const keys = Object.keys(OCR_KNOWN_TERMS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const proper = OCR_KNOWN_TERMS[key];
    const core = key.split("").join("[\\s-]{0,2}");
    const re = new RegExp(`(?<![A-Za-z0-9])${core}(?![A-Za-z0-9])`, "gi");
    out = out.replace(re, (m) => (/\s/.test(m) && /[A-Z]/.test(m) ? proper : m));
  }
  return out;
}

/**
 * 尝试修复 OCR 断词伪影（保守策略）。
 * 1. 将 token 去空格拼接后匹配已知术语词典；
 * 2. 对未命中的纯字母短碎片（1–2 字符）与相邻 token 合并。
 * 返回修复后的字符串；无法修复则原样返回。
 */
export function repairOcrSplinter(s: string): string {
  // 策略 0：字符级词典合并（可处理 "HDM I+DP" 等 token 级策略无法命中的粘连）
  const merged0 = repairByCharMerge(s);
  if (!hasOcrArtifact(merged0)) return merged0;
  const tokens = merged0.split(" ");

  // 策略 1：在连续 Latin token 中查找可修复的子序列
  const latinRun: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^[A-Za-z0-9/-]+$/.test(tokens[i])) latinRun.push(i);
    else {
      const result = tryRepairRun(tokens, latinRun);
      if (result) return applyRepair(tokens, result);
      latinRun.length = 0;
    }
  }
  const result = tryRepairRun(tokens, latinRun);
  if (result) return applyRepair(tokens, result);

  // 策略 2：合并纯字母短碎片与相邻 token
  const isSplinter = (x: string) =>
    x.length >= 1 && x.length <= 2 && /^[A-Za-z-]+$/.test(x);
  const merged = [...tokens];
  let changed = false;
  for (let i = merged.length - 1; i >= 0; i--) {
    if (!isSplinter(merged[i])) continue;
    if (i > 0 && /^[A-Za-z0-9/-]+$/.test(merged[i - 1]) && merged[i - 1].length <= 5) {
      merged[i - 1] = merged[i - 1] + merged[i];
      merged.splice(i, 1);
      changed = true;
    } else if (i < merged.length - 1 && /^[A-Za-z0-9/-]+$/.test(merged[i + 1]) && merged[i + 1].length <= 5) {
      merged[i + 1] = merged[i] + merged[i + 1];
      merged.splice(i, 1);
      changed = true;
    }
  }
  return changed ? merged.join(" ") : s;
}

interface RepairResult {
  /** 被替换的 token 起始索引 */
  start: number;
  /** 被替换的 token 结束索引（含） */
  end: number;
  /** 替换文本 */
  text: string;
}

/** 对一段连续 Latin token 尝试拼接后查词典，返回精确子序列位置 */
function tryRepairRun(tokens: string[], run: number[]): RepairResult | null {
  if (run.length < 2) return null;
  // 先尝试整个 run
  const joined = run.map((i) => tokens[i]).join("");
  const key = joined.toLowerCase().replace(/[-\s]/g, "");
  const hit = OCR_KNOWN_TERMS[key];
  if (hit) return { start: run[0], end: run[run.length - 1], text: hit };
  // 尝试子序列（从最长开始，保留尾部 token）
  for (let len = Math.min(4, run.length); len >= 2; len--) {
    for (let start = 0; start <= run.length - len; start++) {
      const sub = run.slice(start, start + len).map((i) => tokens[i]).join("");
      const k = sub.toLowerCase().replace(/[-\s]/g, "");
      const h = OCR_KNOWN_TERMS[k];
      if (h) {
        return { start: run[start], end: run[start + len - 1], text: h };
      }
    }
  }
  return null;
}

/** 精确替换指定范围的 token，保留其余部分 */
function applyRepair(tokens: string[], r: RepairResult): string {
  const out = [...tokens.slice(0, r.start), r.text, ...tokens.slice(r.end + 1)];
  return out.join(" ");
}

/**
 * 将模型返回的 JSON 映射为 DraftDocument。
 * 纯函数：不依赖网络与环境变量，便于单元测试。
 */
export function mapAiToDraft(input: ExtractionInput, ai: AiQuote): DraftDocument {
  const supplierName = toNullableStr(ai.supplierName) ?? guessSupplierFromFileName(input.fileName);
  const quoteDate = toNullableStr(ai.quoteDate);
  let validUntil = toNullableStr(ai.validUntil);
  // 有效期若与报价日相同（多为模型误填），视为未识别
  if (validUntil && validUntil === quoteDate) validUntil = null;

  const taxRate = normalizeTaxRate(ai.taxRate);
  const deliveryDays = toNum(ai.deliveryDays);

  const rawItems = Array.isArray(ai.items) ? (ai.items as AiItem[]) : [];
  const lineItems: LineItem[] = rawItems
    .map((it, idx) => {
      const name = toStr(it?.name);
      const quantity = toNum(it?.quantity);
      const unitPrice = toNum(it?.unitPrice);
      let subtotal = toNum(it?.subtotal);
      if (subtotal == null && quantity != null && unitPrice != null) {
        subtotal = round2(quantity * unitPrice);
      }
      return { name, quantity, unitPrice, subtotal, it, idx };
    })
    .filter((x) => x.name !== "")
    .map((x) => {
      // P2-4：尝试修复 OCR 断词（保守：仅修可识别的碎片）；名称与规格字段均需修复
      const repaired = repairOcrSplinter(x.name);
      const rawSpec = toStr(x.it?.spec);
      return { ...x, name: repaired, rawName: x.name, spec: repairOcrSplinter(rawSpec), rawSpec };
    })
    .map((x) => ({
      id: `li-${x.idx + 1}`,
      docId: "",
      originalIndex: x.idx + 1,
      originalName: x.name,
      normalizedName: normalizeName(x.name),
      spec: x.spec,
      brand: toStr(x.it?.brand),
      quantity: x.quantity,
      unit: toStr(x.it?.unit),
      unitPrice: x.unitPrice,
      subtotal: x.subtotal,
      taxRate,
      deliveryDays,
      remark: toStr(x.it?.remark),
      confidence: "high" as const,
      evidence: [
        {
          fileId: "",
          page: 1,
          text: x.rawName,
          sourceType: "ai" as const,
          basis: "百炼 qwen-long 文档理解抽取（值为模型推断，需人工复核）",
        },
      ],
      userConfirmed: false,
      aiValues: {
        originalName: x.rawName,
        spec: x.rawSpec,
        brand: toStr(x.it?.brand),
        quantity: x.quantity,
        unit: toStr(x.it?.unit),
        unitPrice: x.unitPrice,
        subtotal: x.subtotal,
        taxRate,
      },
    }));

  const shippingFee = toNum(ai.shippingFee);
  const shippingStatusRaw = toStr(ai.shippingStatus);
  const shippingStatus: DraftDocument["shippingStatus"] =
    shippingStatusRaw === "included" || shippingStatusRaw === "separate"
      ? shippingStatusRaw
      : shippingFee != null && shippingFee > 0
        ? "separate"
        : "unknown";

  const qualityStatus: DraftDocument["qualityStatus"] =
    lineItems.length > 0 ? "pass" : "warning";

  // P2-01：图片（jpg/png）没有 PDF 文本层，其内容经 OCR / 视觉模型识别
  const ft = input.fileType as FileType;
  const isImage = ft === "jpg" || ft === "png";
  const hasTextLayer = !isImage;

  // P2-02：OCR 断词伪影 → 降为「中」置信度并提示人工复核
  // 注意：originalName 已经修复，用 aiValues 中的原始值检测伪影
  const artifactNames = lineItems
    .map((li) => li.aiValues?.originalName ?? li.originalName)
    .filter((n) => hasOcrArtifact(n));
  if (artifactNames.length > 0) {
    for (const li of lineItems) {
      const raw = li.aiValues?.originalName ?? li.originalName;
      if (hasOcrArtifact(raw)) li.confidence = "medium";
    }
  }

  const qualityNotes: string[] = [];
  if (lineItems.length === 0) qualityNotes.push("AI 未抽取到任何行项目，请人工复核");
  if (isImage)
    qualityNotes.push("图片文件无 PDF 文本层，内容由视觉模型 / OCR 识别，建议重点复核");
  if (artifactNames.length > 0)
    qualityNotes.push(`检测到疑似 OCR 断词（如「${artifactNames[0]}」），已尝试自动修复并降为中置信度，请复核`);

  return {
    fileName: input.fileName,
    fileType: input.fileType as FileType,
    fileSize: input.fileSize,
    pageCount: 1,
    hasTextLayer,
    qualityStatus: artifactNames.length > 0 && qualityStatus === "pass" ? "warning" : qualityStatus,
    qualityNotes,
    analyzed: true,
    supplier: {
      id: "",
      originalName: supplierName,
      normalizedName: normalizeName(supplierName),
      contact: toNullableStr(ai.contact) ?? undefined,
      phone: toNullableStr(ai.phone) ?? undefined,
    },
    quoteDate,
    validUntil,
    currency: toNullableStr(ai.currency) ?? "CNY",
    taxInclusive: toBool(ai.taxInclusive),
    taxRate,
    totalPrice: toNum(ai.totalPrice),
    shippingFee,
    shippingStatus,
    deliveryDays,
    paymentTerms: toNullableStr(ai.paymentTerms),
    warranty: toNullableStr(ai.warranty),
    lineItems,
    fieldConfidence: {},
  };
}

/** 从模型文本中提取 JSON 对象（兼容代码块包裹 / 前后多余文本） */
export function extractJson(text: string): AiQuote {
  const stripped = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/,"")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型返回内容中未找到 JSON 对象");
  }
  const jsonStr = stripped.slice(start, end + 1);
  return JSON.parse(jsonStr) as AiQuote;
}

// ------------------------------------------------------------
// 网络调用
// ------------------------------------------------------------
function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/** 上传文件至百炼，返回 file-fe-xxx 文件 ID */
async function uploadFile(input: ExtractionInput, apiKey: string): Promise<string> {
  const form = new FormData();
  const blob = new Blob([input.data as BlobPart], { type: mimeFor(input.fileType) });
  form.append("file", blob, input.fileName);
  form.append("purpose", "file-extract");

  const res = await fetchWithTimeout(`${getBaseUrl()}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`文件上传失败 (HTTP ${res.status})：${detail || res.statusText}`);
  }
  const json = (await res.json()) as { id?: string; status?: string };
  if (!json.id) throw new Error("文件上传响应缺少 id 字段");
  return json.id;
}

/** 调用 qwen-long 进行文档理解，返回模型文本 */
async function callQwenLong(fileId: string, apiKey: string): Promise<string> {
  const res = await fetchWithTimeout(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `fileid://${fileId}` },
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        { role: "user", content: USER_PROMPT },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`模型调用失败 (HTTP ${res.status})：${detail || res.statusText}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型返回内容为空");
  return content;
}

/** 尽力删除临时上传文件（失败不抛出） */
async function deleteFileBestEffort(fileId: string, apiKey: string): Promise<void> {
  try {
    await fetchWithTimeout(`${getBaseUrl()}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // 忽略清理失败
  }
}

/**
 * 真实的百炼文档理解抽取调用。
 * 上传文件 → qwen-long 抽取 JSON → 映射为 DraftDocument。
 */
async function callBailianExtraction(
  input: ExtractionInput,
  apiKey: string
): Promise<{ document: DraftDocument; rawText: string }> {
  const fileId = await uploadFile(input, apiKey);
  try {
    const content = await callQwenLong(fileId, apiKey);
    const ai = extractJson(content);
    const document = mapAiToDraft(input, ai);
    attachXlsxEvidenceLocation(document, input);
    return { document, rawText: content };
  } finally {
    await deleteFileBestEffort(fileId, apiKey);
  }
}

/**
 * 第七轮 P2：Excel 来源文件回填证据精确定位（工作表名 + 单元格区域）。
 * 在本地工作簿中按行项目原始名称检索；定位失败不影响主流程。
 */
export function attachXlsxEvidenceLocation(document: DraftDocument, input: ExtractionInput): void {
  if (input.fileType !== "xlsx" && input.fileType !== "xls") return;
  for (const li of document.lineItems) {
    const needle = li.aiValues?.originalName ?? li.originalName;
    const loc = locateTextInWorkbook(input.data, needle);
    if (!loc) continue;
    for (const ev of li.evidence) {
      ev.sheetName = loc.sheetName;
      ev.cell = loc.cell;
    }
  }
}

// ------------------------------------------------------------
// 提供器实现
// ------------------------------------------------------------
export const bailianProvider: ExtractionProvider = {
  id: "bailian",
  label: "百炼多模态大模型",
  description:
    "调用阿里云百炼 qwen-long 进行智能文档理解抽取（需配置 DASHSCOPE_API_KEY，会产生调用费用）。",
  serverOnly: true,

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "未配置 DASHSCOPE_API_KEY，无法使用百炼 AI 抽取。请先配置密钥或改用「本地规则解析」。"
      );
    }
    const { document, rawText } = await callBailianExtraction(input, apiKey);
    return { document, rawText, providerId: "bailian", parsed: true };
  },
};
