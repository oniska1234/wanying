import { describe, it, expect } from "vitest";
import {
  buildMatchGroupsLocal,
  enforceSpecIsolation,
  extractAttrs,
  hardConflict,
} from "./quote-match";
import { buildMatchGroups } from "./quote-utils";
import type { LineItem, QuoteDocument } from "./quote-types";

// ------------------------------------------------------------
// 工厂
// ------------------------------------------------------------
function li(docId: string, idx: number, name: string, spec = "", brand = ""): LineItem {
  return {
    id: `${docId}-li-${idx}`,
    docId,
    originalIndex: idx,
    originalName: name,
    normalizedName: name,
    spec,
    brand,
    quantity: 1,
    unit: "个",
    unitPrice: 10,
    subtotal: 10,
    taxRate: null,
    deliveryDays: null,
    remark: "",
    confidence: "high",
    evidence: [],
    userConfirmed: false,
  };
}

function doc(id: string, items: LineItem[]): QuoteDocument {
  return {
    id,
    projectId: "p",
    fileName: `${id}.pdf`,
    fileType: "pdf",
    fileSize: 1,
    pageCount: 1,
    hasTextLayer: true,
    qualityStatus: "pass",
    qualityNotes: [],
    analyzed: true,
    supplier: { id: `s-${id}`, originalName: id, normalizedName: id },
    quoteDate: null,
    validUntil: null,
    currency: "CNY",
    taxInclusive: true,
    taxRate: 0.13,
    totalPrice: null,
    shippingFee: null,
    shippingStatus: "included",
    deliveryDays: null,
    paymentTerms: null,
    warranty: null,
    lineItems: items,
    fieldConfidence: {},
  };
}

const docsOf = (groups: ReturnType<typeof buildMatchGroupsLocal>) => groups;

// ------------------------------------------------------------
// CASE01：标准办公用品 —— 必须归为 3 个三供应商组
// ------------------------------------------------------------
describe("CASE01 标准办公用品匹配", () => {
  const d1 = doc("嘉禾", [
    li("嘉禾", 1, "A4复印纸", "70g 500张/包"),
    li("嘉禾", 2, "黑色中性笔", "0.5mm 12支/盒"),
    li("嘉禾", 3, "蓝色文件夹", "A4 10个/包"),
  ]);
  const d2 = doc("华东", [
    li("华东", 1, "打印纸 A4", "70克 500 sheets/ream"),
    li("华东", 2, "签字笔（黑）", "0.5毫米 12支装"),
    li("华东", 3, "资料夹-蓝", "A4每包10个"),
  ]);
  const d3 = doc("NorthStar", [
    li("NorthStar", 1, "A4 Copy Paper", "70gsm, 500 sheets"),
    li("NorthStar", 2, "Gel Pen Black", "0.5mm, 12 pcs/box"),
    li("NorthStar", 3, "File Folder Blue", "A4, 10 pcs/pack"),
  ]);
  const documents = [d1, d2, d3];

  it("生成且仅生成 3 个商品组", () => {
    const groups = buildMatchGroups(documents);
    expect(groups).toHaveLength(3);
  });

  it("每组均为确定匹配且覆盖三家供应商", () => {
    const groups = buildMatchGroups(documents);
    for (const g of groups) {
      expect(g.status).toBe("confirmed");
      expect(g.lineItemIds).toHaveLength(3);
      const docIds = new Set(
        g.lineItemIds.map((id) => id.split("-li-")[0])
      );
      expect(docIds.size).toBe(3);
    }
  });

  it("纸张 / 笔 / 文件夹 各自正确归组", () => {
    const groups = buildMatchGroups(documents);
    const namesOf = (g: (typeof groups)[number]) =>
      g.lineItemIds.map((id) => {
        for (const d of documents) {
          const x = d.lineItems.find((l) => l.id === id);
          if (x) return x.originalName;
        }
        return "";
      });
    const joined = groups.map((g) => namesOf(g).join("|"));
    expect(joined.some((s) => s.includes("A4复印纸") && s.includes("打印纸 A4") && s.includes("A4 Copy Paper"))).toBe(true);
    expect(joined.some((s) => s.includes("黑色中性笔") && s.includes("签字笔（黑）") && s.includes("Gel Pen Black"))).toBe(true);
    expect(joined.some((s) => s.includes("蓝色文件夹") && s.includes("资料夹-蓝") && s.includes("File Folder Blue"))).toBe(true);
  });
});

// ------------------------------------------------------------
// CASE02：电脑设备 —— 规格冲突必须隔离，显示器可合并
// ------------------------------------------------------------
describe("CASE02 规格冲突隔离", () => {
  const laptops = [
    doc("数码先锋", [li("数码先锋", 1, "ThinkBook 14+", "16GB 512GB SSD", "Lenovo")]),
    doc("优联数码", [li("优联数码", 1, "ThinkBook 14 Plus", "8GB 512GB", "Lenovo")]),
    doc("Global", [li("Global", 1, "ThinkBook 14+", "16GB 1TB SSD", "Lenovo")]),
  ];

  it("三种笔记本配置保持隔离（3 个独有组）", () => {
    const groups = buildMatchGroups(laptops);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.status === "unique")).toBe(true);
  });

  it("等价显示器合并为一组", () => {
    const monitors = [
      doc("A", [li("A", 1, "27英寸 4K 显示器", "IPS 27寸")]),
      doc("B", [li("B", 1, "27寸 4K 显示屏", "27英寸 IPS")]),
      doc("C", [li("C", 1, '27" 4K Monitor', "IPS panel")]),
    ];
    const groups = buildMatchGroups(monitors);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe("confirmed");
    expect(groups[0].lineItemIds).toHaveLength(3);
  });

  it("笔记本 + 显示器混合：4 组（3 独有笔记本 + 1 显示器组）", () => {
    const mixed = [
      doc("A", [
        li("A", 1, "ThinkBook 14+", "16GB 512GB SSD"),
        li("A", 2, "27英寸 4K 显示器", "IPS 27寸"),
      ]),
      doc("B", [
        li("B", 1, "ThinkBook 14 Plus", "8GB 512GB"),
        li("B", 2, "27寸 4K 显示屏", "27英寸 IPS"),
      ]),
      doc("C", [
        li("C", 1, "ThinkBook 14+", "16GB 1TB SSD"),
        li("C", 2, '27" 4K Monitor', "IPS panel"),
      ]),
    ];
    const groups = buildMatchGroups(mixed);
    expect(groups).toHaveLength(4);
    const confirmed = groups.filter((g) => g.status === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].lineItemIds).toHaveLength(3);
  });
});

// ------------------------------------------------------------
// 硬冲突 / 属性抽取 单元
// ------------------------------------------------------------
describe("hardConflict 与 extractAttrs", () => {
  it("容量不同即冲突", () => {
    const a = extractAttrs(li("x", 1, "笔记本", "16GB 512GB"));
    const b = extractAttrs(li("y", 1, "笔记本", "8GB 512GB"));
    expect(hardConflict(a, b)).toBe(true);
  });
  it("容量相同不冲突", () => {
    const a = extractAttrs(li("x", 1, "笔记本", "16GB 512GB"));
    const b = extractAttrs(li("y", 1, "笔记本", "16GB 512GB SSD"));
    expect(hardConflict(a, b)).toBe(false);
  });
  it("颜色不同即冲突", () => {
    const a = extractAttrs(li("x", 1, "黑色中性笔"));
    const b = extractAttrs(li("y", 1, "蓝色中性笔"));
    expect(hardConflict(a, b)).toBe(true);
  });
  it("类别识别：中英别名同归一类", () => {
    expect(extractAttrs(li("x", 1, "A4复印纸")).category).toBe("paper");
    expect(extractAttrs(li("x", 1, "A4 Copy Paper")).category).toBe("paper");
    expect(extractAttrs(li("x", 1, "Gel Pen Black")).category).toBe("pen");
    expect(extractAttrs(li("x", 1, "签字笔（黑）")).category).toBe("pen");
  });
  // P1-01 第三轮：中文简写与 CJK 边界
  it("容量简写 16G/512G 正确抽取并归一为 GB", () => {
    const a = extractAttrs(li("x", 1, "ThinkBook 14+", "i5/16G/512G"));
    expect(a.caps.has("16GB")).toBe(true);
    expect(a.caps.has("512GB")).toBe(true);
  });
  it("容量后接 CJK（16GB内存）仍能识别", () => {
    const a = extractAttrs(li("x", 1, "笔记本", "16GB内存 512GB固态"));
    expect(a.caps.has("16GB")).toBe(true);
    expect(a.caps.has("512GB")).toBe(true);
  });
  it("1T 简写归一为 1TB", () => {
    const a = extractAttrs(li("x", 1, "笔记本", "16G/1T"));
    expect(a.caps.has("1TB")).toBe(true);
  });
  it("2.4GHz 不被误识为容量", () => {
    const a = extractAttrs(li("x", 1, "路由器", "2.4GHz 双频"));
    expect(a.caps.size).toBe(0);
  });
  it("分辨率后接 CJK（4K显示器）仍能识别", () => {
    const a = extractAttrs(li("x", 1, "4K显示器", "27英寸 IPS"));
    expect(a.res.has("4K")).toBe(true);
    expect(a.screen.has("27")).toBe(true);
  });
  it("中文简写格式冲突检测：16G/512G vs 8G/512G", () => {
    const a = extractAttrs(li("x", 1, "ThinkBook 14+", "i5/16G/512G"));
    const b = extractAttrs(li("y", 1, "ThinkBook 14 Plus", "i5/8G/512G"));
    expect(hardConflict(a, b)).toBe(true);
  });
  it("CJK 边界格式冲突检测：16GB内存 vs 8GB内存", () => {
    const a = extractAttrs(li("x", 1, "笔记本", "16GB内存 512GB固态"));
    const b = extractAttrs(li("y", 1, "笔记本", "8GB内存 512GB固态"));
    expect(hardConflict(a, b)).toBe(true);
  });
});

// ------------------------------------------------------------
// enforceSpecIsolation 安全网：错误的 AI 合并会被拆回
// ------------------------------------------------------------
describe("enforceSpecIsolation 安全网", () => {
  it("把含 8GB/16GB 冲突的错误组拆为两组", () => {
    const d1 = doc("A", [li("A", 1, "ThinkBook 14+", "16GB 512GB SSD")]);
    const d2 = doc("B", [li("B", 1, "ThinkBook 14 Plus", "8GB 512GB")]);
    const documents = [d1, d2];
    const wrongGroup = {
      id: "mg-bad",
      normalizedName: "ThinkBook",
      normalizedSpec: "",
      status: "confirmed" as const,
      reason: "AI 误合并",
      lineItemIds: ["A-li-1", "B-li-1"],
      userConfirmed: false,
    };
    const fixed = enforceSpecIsolation([wrongGroup], documents);
    expect(fixed).toHaveLength(2);
    expect(fixed.every((g) => g.lineItemIds.length === 1)).toBe(true);
  });

  it("无冲突的组保持不变", () => {
    const d1 = doc("A", [li("A", 1, "A4复印纸", "70g")]);
    const d2 = doc("B", [li("B", 1, "A4 Copy Paper", "70gsm")]);
    const documents = [d1, d2];
    const g = {
      id: "mg-ok",
      normalizedName: "A4纸",
      normalizedSpec: "",
      status: "confirmed" as const,
      reason: "",
      lineItemIds: ["A-li-1", "B-li-1"],
      userConfirmed: false,
    };
    const fixed = enforceSpecIsolation([g], documents);
    expect(fixed).toHaveLength(1);
    expect(fixed[0].lineItemIds).toHaveLength(2);
  });
});

// 引用避免未使用告警
void docsOf;
