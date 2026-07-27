import type {
  ComparisonProject,
  QuoteDocument,
  MatchGroup,
  Anomaly,
  UploadFile,
  MatchStatus,
  LineItem,
} from "./quote-types";
import { detectAnomalies } from "./quote-utils";

// ============================================================
// 报价齐 · Mock 数据（3 份办公用品报价）
// ============================================================

const doc1: QuoteDocument = {
  id: "doc-1",
  projectId: "proj-1",
  fileName: "晨光文具报价单.pdf",
  fileType: "pdf",
  fileSize: 245000,
  pageCount: 2,
  hasTextLayer: true,
  qualityStatus: "pass",
  qualityNotes: [],
  supplier: {
    id: "sup-1",
    originalName: "上海晨光文具股份有限公司",
    normalizedName: "晨光文具",
    contact: "张经理",
    phone: "021-5100xxxx",
  },
  quoteDate: "2026-07-20",
  validUntil: "2026-08-20",
  currency: "CNY",
  taxInclusive: true,
  taxRate: 0.13,
  totalPrice: 4680,
  shippingFee: 0,
  shippingStatus: "included",
  deliveryDays: 3,
  paymentTerms: "月结30天",
  warranty: "质量问题30天包换",
  fieldConfidence: {
    supplier: "high",
    quoteDate: "high",
    totalPrice: "high",
    taxRate: "high",
    shippingFee: "high",
  },
  lineItems: [
    {
      id: "li-1-1",
      docId: "doc-1",
      originalIndex: 1,
      originalName: "A4复印纸 70g 500张/包",
      normalizedName: "A4复印纸70g",
      spec: "70g/m², A4, 500张/包",
      brand: "晨光",
      quantity: 50,
      unit: "包",
      unitPrice: 28,
      subtotal: 1400,
      taxRate: 0.13,
      deliveryDays: 3,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-1", page: 1, text: "A4复印纸 70g 500张/包  50  28.00  1400.00" }],
      userConfirmed: false,
    },
    {
      id: "li-1-2",
      docId: "doc-1",
      originalIndex: 2,
      originalName: "黑色中性笔 0.5mm 12支/盒",
      normalizedName: "中性笔0.5mm黑色",
      spec: "0.5mm, 黑色, 12支/盒",
      brand: "晨光",
      quantity: 30,
      unit: "盒",
      unitPrice: 18,
      subtotal: 540,
      taxRate: 0.13,
      deliveryDays: 3,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-1", page: 1, text: "黑色中性笔 0.5mm 12支/盒  30  18.00  540.00" }],
      userConfirmed: false,
    },
    {
      id: "li-1-3",
      docId: "doc-1",
      originalIndex: 3,
      originalName: "文件夹 A4双夹",
      normalizedName: "A4双夹文件夹",
      spec: "A4, 双夹, PP材质",
      brand: "晨光",
      quantity: 100,
      unit: "个",
      unitPrice: 5.5,
      subtotal: 550,
      taxRate: 0.13,
      deliveryDays: 3,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-1", page: 1, text: "文件夹 A4双夹  100  5.50  550.00" }],
      userConfirmed: false,
    },
    {
      id: "li-1-4",
      docId: "doc-1",
      originalIndex: 4,
      originalName: "订书机 中号",
      normalizedName: "中号订书机",
      spec: "中号, 可订25页",
      brand: "晨光",
      quantity: 20,
      unit: "个",
      unitPrice: 15,
      subtotal: 300,
      taxRate: 0.13,
      deliveryDays: 3,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-1", page: 1, text: "订书机 中号  20  15.00  300.00" }],
      userConfirmed: false,
    },
    {
      id: "li-1-5",
      docId: "doc-1",
      originalIndex: 5,
      originalName: "便签纸 76x76mm 100页/本",
      normalizedName: "便签纸76x76",
      spec: "76x76mm, 100页/本, 黄色",
      brand: "晨光",
      quantity: 50,
      unit: "本",
      unitPrice: 4.5,
      subtotal: 225,
      taxRate: 0.13,
      deliveryDays: 3,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-1", page: 2, text: "便签纸 76x76mm 100页/本  50  4.50  225.00" }],
      userConfirmed: false,
    },
    {
      id: "li-1-6",
      docId: "doc-1",
      originalIndex: 6,
      originalName: "白板笔 可擦 4支/套",
      normalizedName: "白板笔可擦套装",
      spec: "可擦, 4支/套(黑红蓝绿)",
      brand: "晨光",
      quantity: 20,
      unit: "套",
      unitPrice: 22,
      subtotal: 440,
      taxRate: 0.13,
      deliveryDays: 3,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-1", page: 2, text: "白板笔 可擦 4支/套  20  22.00  440.00" }],
      userConfirmed: false,
    },
  ],
};

const doc2: QuoteDocument = {
  id: "doc-2",
  projectId: "proj-1",
  fileName: "得力办公报价.xlsx",
  fileType: "xlsx",
  fileSize: 89000,
  pageCount: 1,
  hasTextLayer: true,
  qualityStatus: "pass",
  qualityNotes: [],
  supplier: {
    id: "sup-2",
    originalName: "得力集团有限公司",
    normalizedName: "得力办公",
    contact: "李销售",
    phone: "0574-6266xxxx",
  },
  quoteDate: "2026-07-18",
  validUntil: "2026-08-18",
  currency: "CNY",
  taxInclusive: false,
  taxRate: 0.13,
  totalPrice: 4250,
  shippingFee: 150,
  shippingStatus: "separate",
  deliveryDays: 5,
  paymentTerms: "款到发货",
  warranty: "质量问题15天包换",
  fieldConfidence: {
    supplier: "high",
    quoteDate: "high",
    totalPrice: "high",
    taxRate: "high",
    shippingFee: "high",
  },
  lineItems: [
    {
      id: "li-2-1",
      docId: "doc-2",
      originalIndex: 1,
      originalName: "复印纸 A4 70克 500张",
      normalizedName: "A4复印纸70g",
      spec: "70g/m², A4, 500张/包",
      brand: "得力",
      quantity: 50,
      unit: "包",
      unitPrice: 25,
      subtotal: 1250,
      taxRate: 0.13,
      deliveryDays: 5,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-2", page: 1, text: "复印纸 A4 70克 500张 | 50 | 25.00 | 1250.00" }],
      userConfirmed: false,
    },
    {
      id: "li-2-2",
      docId: "doc-2",
      originalIndex: 2,
      originalName: "签字笔 黑色 0.5 12支装",
      normalizedName: "中性笔0.5mm黑色",
      spec: "0.5mm, 黑色, 12支/盒",
      brand: "得力",
      quantity: 30,
      unit: "盒",
      unitPrice: 15,
      subtotal: 450,
      taxRate: 0.13,
      deliveryDays: 5,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-2", page: 1, text: "签字笔 黑色 0.5 12支装 | 30 | 15.00 | 450.00" }],
      userConfirmed: false,
    },
    {
      id: "li-2-3",
      docId: "doc-2",
      originalIndex: 3,
      originalName: "资料夹 双强力夹 A4",
      normalizedName: "A4双夹文件夹",
      spec: "A4, 双强力夹, PP",
      brand: "得力",
      quantity: 100,
      unit: "个",
      unitPrice: 6,
      subtotal: 600,
      taxRate: 0.13,
      deliveryDays: 5,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-2", page: 1, text: "资料夹 双强力夹 A4 | 100 | 6.00 | 600.00" }],
      userConfirmed: false,
    },
    {
      id: "li-2-4",
      docId: "doc-2",
      originalIndex: 4,
      originalName: "订书机 12号 中号",
      normalizedName: "中号订书机",
      spec: "中号, 12号针, 可订20页",
      brand: "得力",
      quantity: 20,
      unit: "个",
      unitPrice: 12,
      subtotal: 240,
      taxRate: 0.13,
      deliveryDays: 5,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-2", page: 1, text: "订书机 12号 中号 | 20 | 12.00 | 240.00" }],
      userConfirmed: false,
    },
    {
      id: "li-2-5",
      docId: "doc-2",
      originalIndex: 5,
      originalName: "记事贴 3x3英寸 100页",
      normalizedName: "便签纸76x76",
      spec: "76x76mm(3x3in), 100页/本",
      brand: "得力",
      quantity: 50,
      unit: "本",
      unitPrice: 3.8,
      subtotal: 190,
      taxRate: 0.13,
      deliveryDays: 5,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-2", page: 1, text: "记事贴 3x3英寸 100页 | 50 | 3.80 | 190.00" }],
      userConfirmed: false,
    },
    {
      id: "li-2-6",
      docId: "doc-2",
      originalIndex: 6,
      originalName: "白板笔 易擦 红黑蓝 各1",
      normalizedName: "白板笔可擦套装",
      spec: "可擦, 3支/套(黑红蓝)",
      brand: "得力",
      quantity: 20,
      unit: "套",
      unitPrice: 16,
      subtotal: 320,
      taxRate: 0.13,
      deliveryDays: 5,
      remark: "比晨光少1支绿色",
      confidence: "medium",
      evidence: [{ fileId: "doc-2", page: 1, text: "白板笔 易擦 红黑蓝 各1 | 20 | 16.00 | 320.00" }],
      userConfirmed: false,
    },
  ],
};

const doc3: QuoteDocument = {
  id: "doc-3",
  projectId: "proj-1",
  fileName: "齐心集团报价单.jpg",
  fileType: "jpg",
  fileSize: 1850000,
  pageCount: 1,
  hasTextLayer: false,
  qualityStatus: "warning",
  qualityNotes: ["图片分辨率偏低(1200x800)，部分数字可能识别不准"],
  supplier: {
    id: "sup-3",
    originalName: "深圳齐心集团股份有限公司",
    normalizedName: "齐心办公",
    contact: "王业务",
    phone: "0755-8398xxxx",
  },
  quoteDate: "2026-07-22",
  validUntil: "2026-09-22",
  currency: "CNY",
  taxInclusive: true,
  taxRate: 0.13,
  totalPrice: 5100,
  shippingFee: null,
  shippingStatus: "unknown",
  deliveryDays: 7,
  paymentTerms: "预付50%，货到付余款",
  warranty: "质量问题7天包退",
  fieldConfidence: {
    supplier: "high",
    quoteDate: "medium",
    totalPrice: "medium",
    taxRate: "high",
    shippingFee: "low",
  },
  lineItems: [
    {
      id: "li-3-1",
      docId: "doc-3",
      originalIndex: 1,
      originalName: "多功能复印纸 A4 70g",
      normalizedName: "A4复印纸70g",
      spec: "70g/m², A4, 500张/包",
      brand: "齐心",
      quantity: 50,
      unit: "包",
      unitPrice: 26.5,
      subtotal: 1325,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "",
      confidence: "medium",
      evidence: [{ fileId: "doc-3", page: 1, text: "多功能复印纸 A4 70g ... 50 ... 26.50 ... 1325.00", ocrConfidence: 0.82 }],
      userConfirmed: false,
    },
    {
      id: "li-3-2",
      docId: "doc-3",
      originalIndex: 2,
      originalName: "办公签字笔 黑 0.5 一盒12支",
      normalizedName: "中性笔0.5mm黑色",
      spec: "0.5mm, 黑色, 12支/盒",
      brand: "齐心",
      quantity: 30,
      unit: "盒",
      unitPrice: 16.5,
      subtotal: 495,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "",
      confidence: "medium",
      evidence: [{ fileId: "doc-3", page: 1, text: "办公签字笔 黑 0.5 一盒12支 ... 30 ... 16.50 ... 495", ocrConfidence: 0.78 }],
      userConfirmed: false,
    },
    {
      id: "li-3-3",
      docId: "doc-3",
      originalIndex: 3,
      originalName: "A4 文件夹 双夹式",
      normalizedName: "A4双夹文件夹",
      spec: "A4, 双夹, PP",
      brand: "齐心",
      quantity: 100,
      unit: "个",
      unitPrice: 5.8,
      subtotal: 580,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-3", page: 1, text: "A4 文件夹 双夹式 ... 100 ... 5.80 ... 580.00", ocrConfidence: 0.91 }],
      userConfirmed: false,
    },
    {
      id: "li-3-4",
      docId: "doc-3",
      originalIndex: 4,
      originalName: "订书器 标准型",
      normalizedName: "中号订书机",
      spec: "标准型/中号, 可订25页",
      brand: "齐心",
      quantity: 20,
      unit: "个",
      unitPrice: 13.5,
      subtotal: 270,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "",
      confidence: "medium",
      evidence: [{ fileId: "doc-3", page: 1, text: "订书器 标准型 ... 20 ... 13.50 ... 270.00", ocrConfidence: 0.85 }],
      userConfirmed: false,
    },
    {
      id: "li-3-5",
      docId: "doc-3",
      originalIndex: 5,
      originalName: "便利贴 方形 黄色 100张",
      normalizedName: "便签纸76x76",
      spec: "76x76mm, 100页/本, 黄色",
      brand: "齐心",
      quantity: 50,
      unit: "本",
      unitPrice: 4.2,
      subtotal: 210,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "",
      confidence: "medium",
      evidence: [{ fileId: "doc-3", page: 1, text: "便利贴 方形 黄色 100张 ... 50 ... 4.20 ... 210", ocrConfidence: 0.8 }],
      userConfirmed: false,
    },
    {
      id: "li-3-6",
      docId: "doc-3",
      originalIndex: 6,
      originalName: "白板笔 可擦除 4色套装",
      normalizedName: "白板笔可擦套装",
      spec: "可擦, 4支/套(黑红蓝绿)",
      brand: "齐心",
      quantity: 20,
      unit: "套",
      unitPrice: 20,
      subtotal: 400,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "",
      confidence: "high",
      evidence: [{ fileId: "doc-3", page: 1, text: "白板笔 可擦除 4色套装 ... 20 ... 20.00 ... 400.00", ocrConfidence: 0.93 }],
      userConfirmed: false,
    },
    {
      id: "li-3-7",
      docId: "doc-3",
      originalIndex: 7,
      originalName: "桌面收纳盒 三层",
      normalizedName: "桌面收纳盒三层",
      spec: "三层, 塑料, 30x20x25cm",
      brand: "齐心",
      quantity: 10,
      unit: "个",
      unitPrice: 35,
      subtotal: 350,
      taxRate: 0.13,
      deliveryDays: 7,
      remark: "其他供应商未报此项",
      confidence: "high",
      evidence: [{ fileId: "doc-3", page: 1, text: "桌面收纳盒 三层 ... 10 ... 35.00 ... 350.00", ocrConfidence: 0.9 }],
      userConfirmed: false,
    },
  ],
};

// ------------------------------------------------------------
// 匹配组
// ------------------------------------------------------------
const matchGroups: MatchGroup[] = [
  {
    id: "mg-1",
    normalizedName: "A4复印纸70g",
    normalizedSpec: "70g/m², A4, 500张/包",
    status: "confirmed",
    reason: "品牌+规格完全一致，仅名称表述不同",
    lineItemIds: ["li-1-1", "li-2-1", "li-3-1"],
    userConfirmed: false,
  },
  {
    id: "mg-2",
    normalizedName: "中性笔0.5mm黑色",
    normalizedSpec: "0.5mm, 黑色, 12支/盒",
    status: "confirmed",
    reason: "规格完全一致",
    lineItemIds: ["li-1-2", "li-2-2", "li-3-2"],
    userConfirmed: false,
  },
  {
    id: "mg-3",
    normalizedName: "A4双夹文件夹",
    normalizedSpec: "A4, 双夹, PP材质",
    status: "confirmed",
    reason: "规格一致",
    lineItemIds: ["li-1-3", "li-2-3", "li-3-3"],
    userConfirmed: false,
  },
  {
    id: "mg-4",
    normalizedName: "中号订书机",
    normalizedSpec: "中号, 可订20-25页",
    status: "confirmed",
    reason: "功能规格一致，订页能力略有差异",
    lineItemIds: ["li-1-4", "li-2-4", "li-3-4"],
    userConfirmed: false,
  },
  {
    id: "mg-5",
    normalizedName: "便签纸76x76",
    normalizedSpec: "76x76mm, 100页/本",
    status: "confirmed",
    reason: "尺寸和页数一致",
    lineItemIds: ["li-1-5", "li-2-5", "li-3-5"],
    userConfirmed: false,
  },
  {
    id: "mg-6",
    normalizedName: "白板笔可擦套装",
    normalizedSpec: "可擦, 套装",
    status: "possible",
    reason: "得力为3支/套(黑红蓝)，晨光和齐心为4支/套(含绿)，配置不同需确认",
    lineItemIds: ["li-1-6", "li-2-6", "li-3-6"],
    userConfirmed: false,
  },
  {
    id: "mg-7",
    normalizedName: "桌面收纳盒三层",
    normalizedSpec: "三层, 塑料, 30x20x25cm",
    status: "unique",
    reason: "仅齐心报价包含此项",
    lineItemIds: ["li-3-7"],
    userConfirmed: false,
  },
];

// ------------------------------------------------------------
// 异常
// ------------------------------------------------------------
const anomalies: Anomaly[] = [
  {
    id: "ano-1",
    type: "missing_value",
    severity: "warning",
    message: "齐心办公运费状态未知，无法进行含运费总价比较",
    docId: "doc-3",
  },
  {
    id: "ano-2",
    type: "tax_mismatch",
    severity: "info",
    message: "得力办公报价为未税价，其余两家为含税价，对比时需注意口径",
    docId: "doc-2",
  },
  {
    id: "ano-3",
    type: "math_error",
    severity: "warning",
    message: "齐心办公行项目小计之和(3630)与报价总价(5100)不一致，差额1470元可能含未列明费用",
    docId: "doc-3",
    expected: "3630",
    actual: "5100",
  },
];

// ------------------------------------------------------------
// 供应商模板（用于根据真实上传文件生成演示项目）
// ------------------------------------------------------------
const supplierTemplates: QuoteDocument[] = [doc1, doc2, doc3];

/** 以标准化名称为键的匹配组模板（保留细致判断与理由） */
const groupTemplateByName: Record<string, MatchGroup> = Object.fromEntries(
  matchGroups.map((g) => [g.normalizedName, g])
);

const MAX_ANALYZED = 3;

/** 根据真实文件属性推导质量检查结果 */
function deriveQuality(file: UploadFile): {
  status: QuoteDocument["qualityStatus"];
  notes: string[];
  hasTextLayer: boolean;
  pageCount: number;
} {
  if (file.size === 0) {
    return {
      status: "fail",
      notes: ["空白文件，未检测到任何内容"],
      hasTextLayer: false,
      pageCount: 0,
    };
  }
  if (file.type === "jpg" || file.type === "png") {
    return {
      status: "warning",
      notes: ["图片格式需 OCR 识别，分辨率未知，部分数字可能识别不准"],
      hasTextLayer: false,
      pageCount: 1,
    };
  }
  if (file.type === "pdf") {
    return { status: "pass", notes: [], hasTextLayer: true, pageCount: 2 };
  }
  // xlsx / xls
  return { status: "pass", notes: [], hasTextLayer: true, pageCount: 1 };
}

/** 按标准化名称自动生成分组（适用于任意供应商数量） */
function buildMatchGroups(documents: QuoteDocument[]): MatchGroup[] {
  const byName = new Map<string, { spec: string; items: LineItem[] }>();
  for (const doc of documents) {
    for (const li of doc.lineItems) {
      const entry = byName.get(li.normalizedName) ?? { spec: li.spec, items: [] };
      entry.items.push(li);
      byName.set(li.normalizedName, entry);
    }
  }
  const groups: MatchGroup[] = [];
  let idx = 0;
  for (const [name, { spec, items }] of byName) {
    idx++;
    const tmpl = groupTemplateByName[name];
    let status: MatchStatus;
    if (items.length === 1) status = "unique";
    else if (items.length >= documents.length) status = "confirmed";
    else status = "possible";
    if (tmpl?.status) status = tmpl.status; // 保留模板中的细致判断（如配置差异）
    groups.push({
      id: `mg-${idx}`,
      normalizedName: name,
      normalizedSpec: tmpl?.normalizedSpec ?? spec,
      status,
      reason:
        tmpl?.reason ??
        (status === "unique"
          ? "仅一家供应商报价包含此项"
          : status === "confirmed"
            ? "规格一致，仅名称表述不同"
            : "部分供应商缺失或规格存在差异，需人工确认"),
      lineItemIds: items.map((i) => i.id),
      userConfirmed: false,
    });
  }
  return groups;
}

/**
 * 根据真实上传文件生成演示项目。
 * 文件身份（名称/大小/类型/质量）来自真实上传；
 * 抽取内容为内置示例数据（明确标记 demoMode）。
 */
export function buildDemoProject(files: UploadFile[]): ComparisonProject {
  const analyzedFiles = files.slice(0, MAX_ANALYZED);

  const documents: QuoteDocument[] = analyzedFiles.map((file, i) => {
    const tmpl = supplierTemplates[i % supplierTemplates.length];
    const q = deriveQuality(file);
    return {
      ...tmpl,
      id: `doc-${i + 1}`,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      pageCount: q.pageCount,
      hasTextLayer: q.hasTextLayer,
      qualityStatus: q.status,
      qualityNotes: q.notes,
      analyzed: true,
      lineItems: tmpl.lineItems.map((li) => ({ ...li, id: `doc-${i + 1}-${li.id}`, docId: `doc-${i + 1}` })),
    };
  });

  // 超出 3 份的文件：仅做质量检查，不纳入对比
  const extraDocs: QuoteDocument[] = files.slice(MAX_ANALYZED).map((file, i) => {
    const q = deriveQuality(file);
    return {
      ...supplierTemplates[0],
      id: `doc-extra-${i}`,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      pageCount: q.pageCount,
      hasTextLayer: q.hasTextLayer,
      qualityStatus: q.status,
      qualityNotes: [...q.notes, "演示版每次最多深度分析 3 份，此文件未纳入对比"],
      analyzed: false,
      totalPrice: null,
      shippingFee: null,
      supplier: {
        id: `sup-extra-${i}`,
        originalName: "（未纳入分析）",
        normalizedName: "（未纳入分析）",
      },
      lineItems: [],
    };
  });

  const allDocuments = [...documents, ...extraDocs];
  const matchGroups = buildMatchGroups(documents);

  const project: ComparisonProject = {
    id: "proj-1",
    name: "办公用品采购比价（演示）",
    status: "comparing",
    currency: "CNY",
    taxMode: "original",
    includeShipping: false,
    documents: allDocuments,
    matchGroups,
    anomalies: [],
    createdAt: new Date().toISOString(),
    demoMode: true,
    providerId: "demo",
  };
  project.anomalies = detectAnomalies(project);
  return project;
}

// ------------------------------------------------------------
// 静态示例项目（未上传文件时的后备，保留供参考）
// ------------------------------------------------------------
export const mockProject: ComparisonProject = {
  id: "proj-1",
  name: "2026年Q3办公用品采购比价",
  status: "comparing",
  currency: "CNY",
  taxMode: "original",
  includeShipping: false,
  documents: [doc1, doc2, doc3],
  matchGroups,
  anomalies,
  createdAt: "2026-07-25T10:30:00Z",
  demoMode: true,
  providerId: "demo",
};
