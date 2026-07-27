// ============================================================
// 报价齐 · 核心类型定义
// ============================================================

/** 项目状态 */
export type ProjectStatus =
  | "uploading"
  | "checking"
  | "extracting"
  | "reviewing"
  | "matching"
  | "comparing"
  | "done";

/** 文件类型 */
export type FileType = "pdf" | "xlsx" | "xls" | "jpg" | "png";

/** 置信度等级 */
export type ConfidenceLevel = "high" | "medium" | "low";

/** 匹配状态 */
export type MatchStatus = "confirmed" | "possible" | "unmatched" | "unique";

/** 异常类型 */
export type AnomalyType =
  | "math_error"
  | "missing_value"
  | "currency_conflict"
  | "duplicate_item"
  | "expired_quote"
  | "negative_value"
  | "tax_mismatch";

/** 异常严重度 */
export type AnomalySeverity = "error" | "warning" | "info";

// ------------------------------------------------------------
// 证据锚点
// ------------------------------------------------------------
export interface EvidenceAnchor {
  fileId: string;
  page: number;
  /** 原文片段 */
  text: string;
  /** 坐标 [x, y, w, h] 占位 */
  bbox?: [number, number, number, number];
  ocrConfidence?: number;
  /** 来源文件类型（便于展示「来自 PDF 文本层 / Excel 单元格 / 图片 OCR / AI 模型」） */
  sourceType?: "pdf" | "excel" | "image" | "ai";
  /** Excel 工作表名 */
  sheetName?: string;
  /** Excel 单元格 / 区域（如 A3:F3） */
  cell?: string;
  /** 置信度依据说明 */
  basis?: string;
}

// ------------------------------------------------------------
// 行项目
// ------------------------------------------------------------
export interface LineItem {
  id: string;
  docId: string;
  /** 原始序号 */
  originalIndex: number;
  /** 原始名称 */
  originalName: string;
  /** 标准化名称 */
  normalizedName: string;
  /** 规格型号 */
  spec: string;
  /** 品牌 */
  brand: string;
  /** 数量 */
  quantity: number | null;
  /** 原始单位 */
  unit: string;
  /** 单价 */
  unitPrice: number | null;
  /** 小计 */
  subtotal: number | null;
  /** 税率 (0.13 = 13%) */
  taxRate: number | null;
  /** 交期 */
  deliveryDays: number | null;
  /** 备注 */
  remark: string;
  /** 置信度 */
  confidence: ConfidenceLevel;
  /** 证据 */
  evidence: EvidenceAnchor[];
  /** 用户是否已确认 */
  userConfirmed: boolean;
  /**
   * AI / 初次抽取的原始值快照（P1-05）。
   * 用于在证据弹窗中展示「AI 解析值 vs 人工修改值」，形成可审计轨迹。
   */
  aiValues?: Partial<
    Pick<LineItem, "originalName" | "spec" | "brand" | "quantity" | "unit" | "unitPrice" | "subtotal" | "taxRate">
  >;
}

// ------------------------------------------------------------
// 供应商
// ------------------------------------------------------------
export interface Supplier {
  id: string;
  originalName: string;
  normalizedName: string;
  contact?: string;
  phone?: string;
}

// ------------------------------------------------------------
// 报价文档
// ------------------------------------------------------------
export interface QuoteDocument {
  id: string;
  projectId: string;
  fileName: string;
  fileType: FileType;
  fileSize: number;
  pageCount: number;
  /** 是否有文本层 */
  hasTextLayer: boolean;
  /** 质量检查结果 */
  qualityStatus: "pass" | "warning" | "fail";
  qualityNotes: string[];
  /** 是否纳入深度分析（演示版最多 3 份，其余仅做质量检查） */
  analyzed?: boolean;
  /** 供应商信息 */
  supplier: Supplier;
  /** 报价日期 */
  quoteDate: string | null;
  /** 有效期 */
  validUntil: string | null;
  /** 币种 */
  currency: string;
  /** 是否含税 */
  taxInclusive: boolean | null;
  /** 税率 */
  taxRate: number | null;
  /** 总价 */
  totalPrice: number | null;
  /** 运费 */
  shippingFee: number | null;
  /** 运费状态 */
  shippingStatus: "included" | "separate" | "unknown";
  /** 交货期 */
  deliveryDays: number | null;
  /** 付款条件 */
  paymentTerms: string | null;
  /** 质保 */
  warranty: string | null;
  /** 行项目 */
  lineItems: LineItem[];
  /** 字段置信度 */
  fieldConfidence: Record<string, ConfidenceLevel>;
}

// ------------------------------------------------------------
// 匹配组
// ------------------------------------------------------------
export interface MatchGroup {
  id: string;
  /** 标准化名称 */
  normalizedName: string;
  /** 标准化规格 */
  normalizedSpec: string;
  /** 匹配状态 */
  status: MatchStatus;
  /** 匹配理由 */
  reason: string;
  /** 包含的行项目 ID */
  lineItemIds: string[];
  /** 用户确认 */
  userConfirmed: boolean;
}

// ------------------------------------------------------------
// 异常
// ------------------------------------------------------------
export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  /** 描述 */
  message: string;
  /** 关联文件 ID */
  docId?: string;
  /** 关联行项目 ID */
  lineItemId?: string;
  /** 期望值 */
  expected?: string;
  /** 实际值 */
  actual?: string;
}

// ------------------------------------------------------------
// 对比项目
// ------------------------------------------------------------
export interface ComparisonProject {
  id: string;
  name: string;
  status: ProjectStatus;
  currency: string;
  /** 税费口径 */
  taxMode: "original" | "inclusive" | "exclusive";
  /** 是否含运费 */
  includeShipping: boolean;
  documents: QuoteDocument[];
  matchGroups: MatchGroup[];
  anomalies: Anomaly[];
  createdAt: string;
  /** 演示模式：分析结果为内置示例数据（非真实 AI 抽取） */
  demoMode?: boolean;
  /** 实际使用的抽取提供器（用于按解析方式展示数据流 / 隐私说明） */
  providerId?: string;
  /**
   * 多币种汇率表：key 为币种代码（如 "USD"），value 为折算到基准币的汇率与确认状态。
   * 未确认前，跨币种不得计算最低价 / 可比总价（P0-02）。
   */
  exchangeRates?: Record<
    string,
    { rate: number; confirmed: boolean; date?: string; source?: string }
  >;
  /** 基准币种（折算目标，默认 CNY） */
  baseCurrency?: string;
}

// ------------------------------------------------------------
// 上传文件（前端临时状态）
// ------------------------------------------------------------
export interface UploadFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: FileType;
  status: "pending" | "validating" | "valid" | "invalid";
  error?: string;
}

// ------------------------------------------------------------
// 步骤定义
// ------------------------------------------------------------
export const STEPS = [
  { key: "upload", label: "上传报价" },
  { key: "check", label: "质量检查" },
  { key: "extract", label: "抽取复核" },
  { key: "match", label: "匹配复核" },
  { key: "compare", label: "横向对比" },
  { key: "export", label: "导出结果" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];
