import { describe, it, expect } from "vitest";
import {
  verifyLineItem,
  normalizeTax,
  lineAmount,
  shippingPerUnit,
  getComparablePrice,
  markLowest,
  detectAnomalies,
  matchStatusLabel,
  reconcileTotal,
  comparableTotal,
  toBase,
  isFxPending,
} from "./quote-utils";
import type {
  LineItem,
  QuoteDocument,
  ComparisonProject,
} from "./quote-types";

// ------------------------------------------------------------
// 测试工厂
// ------------------------------------------------------------
let seq = 0;
function makeItem(patch: Partial<LineItem> = {}): LineItem {
  seq += 1;
  return {
    id: `li-${seq}`,
    docId: "doc-1",
    originalIndex: seq,
    originalName: `项目${seq}`,
    normalizedName: `项目${seq}`,
    spec: "规格",
    brand: "品牌",
    quantity: 10,
    unit: "个",
    unitPrice: 5,
    subtotal: 50,
    taxRate: 0.13,
    deliveryDays: 3,
    remark: "",
    confidence: "high",
    evidence: [],
    userConfirmed: false,
    ...patch,
  };
}

function makeDoc(patch: Partial<QuoteDocument> = {}): QuoteDocument {
  const lineItems = patch.lineItems ?? [];
  return {
    id: "doc-1",
    projectId: "proj-1",
    fileName: "报价.pdf",
    fileType: "pdf",
    fileSize: 1000,
    pageCount: 1,
    hasTextLayer: true,
    qualityStatus: "pass",
    qualityNotes: [],
    analyzed: true,
    supplier: {
      id: "sup-1",
      originalName: "供应商",
      normalizedName: "供应商",
    },
    quoteDate: "2026-01-01",
    validUntil: "2026-02-01",
    currency: "CNY",
    taxInclusive: true,
    taxRate: 0.13,
    totalPrice: null,
    shippingFee: null,
    shippingStatus: "included",
    deliveryDays: 3,
    paymentTerms: null,
    warranty: null,
    lineItems,
    fieldConfidence: {},
    ...patch,
  };
}

function makeProject(patch: Partial<ComparisonProject> = {}): ComparisonProject {
  return {
    id: "proj-1",
    name: "测试项目",
    status: "comparing",
    currency: "CNY",
    taxMode: "original",
    includeShipping: false,
    documents: [],
    matchGroups: [],
    anomalies: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

// ------------------------------------------------------------
// verifyLineItem 小计校验
// ------------------------------------------------------------
describe("verifyLineItem", () => {
  it("数量×单价等于小计时通过", () => {
    const item = makeItem({ quantity: 50, unitPrice: 28, subtotal: 1400 });
    const r = verifyLineItem(item);
    expect(r.ok).toBe(true);
    expect(r.diff).toBe(0);
  });

  it("数量×单价不等于小计时报错并给出差额", () => {
    const item = makeItem({ quantity: 10, unitPrice: 5, subtotal: 60 });
    const r = verifyLineItem(item);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe(50);
    expect(r.diff).toBe(10);
  });

  it("缺少关键字段时视为通过（无法校验）", () => {
    const item = makeItem({ quantity: null, unitPrice: 5, subtotal: 60 });
    expect(verifyLineItem(item).ok).toBe(true);
  });
});

// ------------------------------------------------------------
// normalizeTax 税费互转
// ------------------------------------------------------------
describe("normalizeTax", () => {
  it("未税 → 含税", () => {
    expect(normalizeTax(25, 0.13, false, true)).toBe(28.25);
  });

  it("含税 → 未税", () => {
    expect(normalizeTax(28.25, 0.13, true, false)).toBe(25);
  });

  it("口径相同时不变", () => {
    expect(normalizeTax(100, 0.13, true, true)).toBe(100);
  });
});

// ------------------------------------------------------------
// lineAmount 行金额
// ------------------------------------------------------------
describe("lineAmount", () => {
  it("优先使用小计", () => {
    expect(lineAmount(makeItem({ subtotal: 999, quantity: 10, unitPrice: 5 }))).toBe(999);
  });

  it("无小计时回退到 数量×单价", () => {
    expect(lineAmount(makeItem({ subtotal: null, quantity: 10, unitPrice: 5 }))).toBe(50);
  });

  it("均缺失时返回 0", () => {
    expect(lineAmount(makeItem({ subtotal: null, quantity: null, unitPrice: null }))).toBe(0);
  });
});

// ------------------------------------------------------------
// shippingPerUnit 运费分摊（P0-02 关键：守恒）
// ------------------------------------------------------------
describe("shippingPerUnit", () => {
  // 得力示例：6 行，运费 150
  const deliItems = [
    makeItem({ quantity: 50, unitPrice: 25, subtotal: 1250 }),
    makeItem({ quantity: 30, unitPrice: 15, subtotal: 450 }),
    makeItem({ quantity: 100, unitPrice: 6, subtotal: 600 }),
    makeItem({ quantity: 20, unitPrice: 12, subtotal: 240 }),
    makeItem({ quantity: 50, unitPrice: 3.8, subtotal: 190 }),
    makeItem({ quantity: 20, unitPrice: 16, subtotal: 320 }),
  ];
  const deliDoc = makeDoc({ lineItems: deliItems, shippingFee: 150, shippingStatus: "separate" });

  it("守恒：所有行 Σ(单位运费×数量) 约等于运费总额", () => {
    const total = deliItems.reduce(
      (s, li) => s + shippingPerUnit(li, deliDoc) * (li.quantity ?? 0),
      0
    );
    // 旧 bug 会算成约 6750；正确结果应非常接近 150
    expect(Math.abs(total - 150)).toBeLessThan(2);
  });

  it("金额占比越高，分摊运费越多", () => {
    const big = shippingPerUnit(deliItems[0], deliDoc); // 复印纸 1250
    const small = shippingPerUnit(deliItems[4], deliDoc); // 记事贴 190
    expect(big).toBeGreaterThan(small);
  });

  it("报告示例：复印纸单位运费约 1.23，而非旧 bug 的 25", () => {
    expect(shippingPerUnit(deliItems[0], deliDoc)).toBeCloseTo(1.23, 2);
  });

  it("运费为 0 或 null 时返回 0", () => {
    expect(shippingPerUnit(deliItems[0], makeDoc({ lineItems: deliItems, shippingFee: 0 }))).toBe(0);
    expect(shippingPerUnit(deliItems[0], makeDoc({ lineItems: deliItems, shippingFee: null }))).toBe(0);
  });

  it("数量为 0 或 null 时返回 0", () => {
    const zero = makeItem({ quantity: 0, unitPrice: 25, subtotal: 0 });
    expect(shippingPerUnit(zero, makeDoc({ lineItems: [zero], shippingFee: 100 }))).toBe(0);
  });
});

// ------------------------------------------------------------
// getComparablePrice 可比单价
// ------------------------------------------------------------
describe("getComparablePrice", () => {
  const item = makeItem({ quantity: 50, unitPrice: 25, subtotal: 1250, taxRate: 0.13 });

  it("原始口径返回原单价", () => {
    const doc = makeDoc({ lineItems: [item], taxInclusive: false });
    expect(getComparablePrice(item, doc, "original", false)).toBe(25);
  });

  it("统一含税：未税价 25 → 28.25", () => {
    const doc = makeDoc({ lineItems: [item], taxInclusive: false, taxRate: 0.13 });
    expect(getComparablePrice(item, doc, "inclusive", false)).toBe(28.25);
  });

  it("统一未税：含税价 28.25 → 25", () => {
    const taxed = makeItem({ quantity: 50, unitPrice: 28.25, subtotal: 1412.5, taxRate: 0.13 });
    const doc = makeDoc({ lineItems: [taxed], taxInclusive: true, taxRate: 0.13 });
    expect(getComparablePrice(taxed, doc, "exclusive", false)).toBe(25);
  });

  it("报告示例：含运费分摊后复印纸 25 → 26.23（绝非旧 bug 的 50）", () => {
    const deliItems = [
      item,
      makeItem({ quantity: 30, unitPrice: 15, subtotal: 450 }),
      makeItem({ quantity: 100, unitPrice: 6, subtotal: 600 }),
      makeItem({ quantity: 20, unitPrice: 12, subtotal: 240 }),
      makeItem({ quantity: 50, unitPrice: 3.8, subtotal: 190 }),
      makeItem({ quantity: 20, unitPrice: 16, subtotal: 320 }),
    ];
    const doc = makeDoc({ lineItems: deliItems, shippingFee: 150, shippingStatus: "separate", taxInclusive: true });
    const price = getComparablePrice(item, doc, "original", true);
    expect(price).toBe(26.23);
    expect(price).toBeLessThan(30); // 旧 bug 会是 50
  });

  it("单价缺失时返回 null", () => {
    const noPrice = makeItem({ unitPrice: null });
    const doc = makeDoc({ lineItems: [noPrice] });
    expect(getComparablePrice(noPrice, doc, "original", false)).toBeNull();
  });
});

// ------------------------------------------------------------
// markLowest 最低价标记
// ------------------------------------------------------------
describe("markLowest", () => {
  it("标记组内最低价行项目", () => {
    const cheap = makeItem({ id: "li-cheap", unitPrice: 10, subtotal: 100, quantity: 10 });
    const pricey = makeItem({ id: "li-pricey", unitPrice: 20, subtotal: 200, quantity: 10 });
    const docA = makeDoc({ id: "docA", lineItems: [cheap] });
    const docB = makeDoc({ id: "docB", lineItems: [pricey] });
    const project = makeProject({
      documents: [docA, docB],
      matchGroups: [
        {
          id: "mg-1",
          normalizedName: "X",
          normalizedSpec: "",
          status: "confirmed",
          reason: "",
          lineItemIds: ["li-cheap", "li-pricey"],
          userConfirmed: false,
        },
      ],
    });
    const marks = markLowest(project.matchGroups[0], project);
    expect(marks.get("li-cheap")).toBe(true);
    expect(marks.get("li-pricey")).toBe(false);
  });
});

// ------------------------------------------------------------
// detectAnomalies 异常检测
// ------------------------------------------------------------
describe("detectAnomalies", () => {
  it("检测小计计算错误", () => {
    const bad = makeItem({ quantity: 10, unitPrice: 5, subtotal: 999 });
    const doc = makeDoc({ id: "d1", lineItems: [bad], totalPrice: 999 });
    const project = makeProject({ documents: [doc] });
    const anos = detectAnomalies(project);
    expect(anos.some((a) => a.type === "math_error" && a.lineItemId === bad.id)).toBe(true);
  });

  it("检测行项目之和与总价不一致", () => {
    const li = makeItem({ quantity: 10, unitPrice: 5, subtotal: 50 });
    const doc = makeDoc({
      id: "d1",
      supplier: { id: "s", originalName: "齐心", normalizedName: "齐心" },
      lineItems: [li],
      totalPrice: 5100,
    });
    const project = makeProject({ documents: [doc] });
    const anos = detectAnomalies(project);
    expect(anos.some((a) => a.type === "math_error" && a.message.includes("不符"))).toBe(true);
  });

  // P1-04：能解释的税费 / 运费差额不得报为算术错误
  it("含税报价行项目之和等于总价：不报异常（CASE01 嘉禾）", () => {
    const li = makeItem({ quantity: 1, unitPrice: 766, subtotal: 766 });
    const doc = makeDoc({
      id: "d1",
      taxInclusive: true,
      taxRate: 0.13,
      lineItems: [li],
      totalPrice: 796,
      shippingFee: 30,
      shippingStatus: "separate",
    });
    expect(reconcileTotal(doc).status).toBe("ok");
    const anos = detectAnomalies(makeProject({ documents: [doc] }));
    expect(anos.some((a) => a.type === "math_error")).toBe(false);
  });

  it("未税报价 + 13% 税 + 运费能解释总价：不报异常（CASE03 锐连）", () => {
    const li = makeItem({ quantity: 1, unitPrice: 18920, subtotal: 18920 });
    const doc = makeDoc({
      id: "d1",
      taxInclusive: false,
      taxRate: 0.13,
      lineItems: [li],
      totalPrice: 21679.6,
      shippingFee: 300,
      shippingStatus: "separate",
    });
    expect(reconcileTotal(doc).status).toBe("ok");
    const anos = detectAnomalies(makeProject({ documents: [doc] }));
    expect(anos.some((a) => a.type === "math_error")).toBe(false);
  });

  it("未税报价但税率缺失：返回 cannotReconstruct 且不静默报错", () => {
    const li = makeItem({ quantity: 1, unitPrice: 100, subtotal: 100 });
    const doc = makeDoc({
      id: "d1",
      taxInclusive: false,
      taxRate: null,
      lineItems: [li],
      totalPrice: 130,
    });
    expect(reconcileTotal(doc).status).toBe("cannotReconstruct");
  });

  it("检测运费状态未知", () => {
    const doc = makeDoc({ id: "d1", lineItems: [], shippingStatus: "unknown" });
    const project = makeProject({ documents: [doc] });
    expect(detectAnomalies(project).some((a) => a.type === "missing_value")).toBe(true);
  });

  it("检测税费口径不一致", () => {
    const exclusive = makeDoc({ id: "d1", lineItems: [], taxInclusive: false });
    const inclusive = makeDoc({ id: "d2", lineItems: [], taxInclusive: true });
    const project = makeProject({ documents: [exclusive, inclusive] });
    expect(detectAnomalies(project).some((a) => a.type === "tax_mismatch")).toBe(true);
  });

  it("跳过未纳入分析的文件（analyzed=false）", () => {
    const bad = makeItem({ quantity: 10, unitPrice: 5, subtotal: 999 });
    const doc = makeDoc({ id: "d1", lineItems: [bad], analyzed: false, totalPrice: 999 });
    const project = makeProject({ documents: [doc] });
    expect(detectAnomalies(project)).toHaveLength(0);
  });
});

// ------------------------------------------------------------
// matchStatusLabel
// ------------------------------------------------------------
describe("matchStatusLabel", () => {
  it("返回中文标签", () => {
    expect(matchStatusLabel("confirmed")).toBe("确定匹配");
    expect(matchStatusLabel("possible")).toBe("可能匹配");
    expect(matchStatusLabel("unique")).toBe("独有项目");
  });
});

// ------------------------------------------------------------
// 多币种与汇率（P0-02）
// ------------------------------------------------------------
describe("currency / exchange rates (P0-02)", () => {
  const usdDoc = () =>
    makeDoc({
      id: "usd",
      currency: "USD",
      taxInclusive: false,
      taxRate: null,
      lineItems: [makeItem({ quantity: 1, unitPrice: 2870, subtotal: 2870 })],
      totalPrice: 2920,
      shippingFee: 50,
      shippingStatus: "separate",
    });

  it("未确认汇率：isFxPending 为 true，toBase 返回 null", () => {
    const ctx = { baseCurrency: "CNY", rates: { USD: { rate: 7.2, confirmed: false } } };
    expect(isFxPending(usdDoc(), ctx)).toBe(true);
    expect(toBase(2920, "USD", ctx)).toBeNull();
  });

  it("未确认汇率：comparableTotal 为 null（不可比）", () => {
    const ctx = { baseCurrency: "CNY", rates: { USD: { rate: 7.2, confirmed: false } } };
    expect(comparableTotal(usdDoc(), "original", false, ctx)).toBeNull();
  });

  it("确认 USD/CNY=7.2 后：可比总价 = 2920×7.2 = 21024（CASE03 验收门槛）", () => {
    const ctx = { baseCurrency: "CNY", rates: { USD: { rate: 7.2, confirmed: true } } };
    expect(isFxPending(usdDoc(), ctx)).toBe(false);
    expect(comparableTotal(usdDoc(), "original", false, ctx)).toBe(21024);
  });

  it("基准币文档无需汇率即可比较", () => {
    const doc = makeDoc({
      id: "cny",
      currency: "CNY",
      taxInclusive: true,
      taxRate: 0.13,
      lineItems: [makeItem({ quantity: 1, unitPrice: 100, subtotal: 100 })],
      totalPrice: 100,
      shippingStatus: "included",
    });
    expect(isFxPending(doc, { baseCurrency: "CNY", rates: {} })).toBe(false);
    expect(comparableTotal(doc, "original", false, { baseCurrency: "CNY", rates: {} })).toBe(100);
  });

  it("运费未知：comparableTotal 为 null（CASE03 供应商A）", () => {
    const doc = makeDoc({
      id: "a",
      currency: "CNY",
      taxInclusive: true,
      taxRate: 0.13,
      lineItems: [makeItem({ quantity: 1, unitPrice: 21600, subtotal: 21600 })],
      totalPrice: 21600,
      shippingFee: null,
      shippingStatus: "unknown",
    });
    expect(comparableTotal(doc, "original", false, { baseCurrency: "CNY", rates: {} })).toBeNull();
  });
});
