import { describe, it, expect } from "vitest";
import {
  parseNum,
  normalizeName,
  detectSupplier,
  detectDate,
  detectTax,
  findHeader,
  structureFromRows,
  structureFromPdfLines,
} from "./rule-provider";

// ------------------------------------------------------------
// parseNum
// ------------------------------------------------------------
describe("parseNum", () => {
  it("去除千分位与货币符号", () => {
    expect(parseNum("1,400.00")).toBe(1400);
    expect(parseNum("¥28")).toBe(28);
    expect(parseNum("￥1,234.5")).toBe(1234.5);
  });
  it("从带单位文本中取数值", () => {
    expect(parseNum("50包")).toBe(50);
  });
  it("空值 / 非法值返回 null", () => {
    expect(parseNum("")).toBeNull();
    expect(parseNum("-")).toBeNull();
    expect(parseNum("abc")).toBeNull();
    expect(parseNum(null)).toBeNull();
  });
});

// ------------------------------------------------------------
// normalizeName
// ------------------------------------------------------------
describe("normalizeName", () => {
  it("去空格标点并小写", () => {
    expect(normalizeName("A4复印纸 70g")).toBe("a4复印纸70g");
    expect(normalizeName("中性笔（0.5mm）")).toBe("中性笔05mm");
  });
});

// ------------------------------------------------------------
// detectSupplier / detectDate / detectTax
// ------------------------------------------------------------
describe("detectSupplier", () => {
  it("识别公司后缀", () => {
    expect(detectSupplier(["报价单", "上海晨光文具股份有限公司", "日期"])).toBe(
      "上海晨光文具股份有限公司"
    );
  });
  it("无公司信息返回 null", () => {
    expect(detectSupplier(["报价单", "名称 数量 单价"])).toBeNull();
  });
});

describe("detectDate", () => {
  it("取标签之后的日期（同行多日期不误取）", () => {
    const lines = ["报价日期：2026-07-20  有效期：2026-08-20"];
    expect(detectDate(lines, /日期|报价日/)).toBe("2026-07-20");
    expect(detectDate(lines, /有效期/)).toBe("2026-08-20");
  });
  it("支持中文日期格式", () => {
    expect(detectDate(["2026年7月5日"], /日期/)).toBe("2026-07-05");
  });
});

describe("detectTax", () => {
  it("识别含税与税率", () => {
    expect(detectTax("以上为含税价，税率13%")).toEqual({
      taxInclusive: true,
      taxRate: 0.13,
    });
  });
  it("识别不含税", () => {
    expect(detectTax("不含税价")).toMatchObject({ taxInclusive: false });
  });
});

// ------------------------------------------------------------
// findHeader
// ------------------------------------------------------------
describe("findHeader", () => {
  it("定位表头行与列索引", () => {
    const rows = [
      ["公司名称", ""],
      ["序号", "名称", "规格", "数量", "单位", "单价", "金额"],
      ["1", "A4纸", "70g", "50", "包", "28", "1400"],
    ];
    const h = findHeader(rows);
    expect(h).not.toBeNull();
    expect(h!.index).toBe(1);
    expect(h!.nameCol).toBe(1);
    expect(h!.qtyCol).toBe(3);
    expect(h!.priceCol).toBe(5);
    expect(h!.amountCol).toBe(6);
  });
});

// ------------------------------------------------------------
// structureFromRows（Excel 全链路）
// ------------------------------------------------------------
describe("structureFromRows", () => {
  const rows = [
    ["上海晨光文具股份有限公司", "", "", "", "", "", ""],
    ["报价日期：2026-07-20", "", "有效期：2026-08-20", "", "", "", ""],
    ["序号", "名称", "规格", "数量", "单位", "单价", "金额"],
    ["1", "A4复印纸 70g", "70g/m²", "50", "包", "28", "1400"],
    ["2", "中性笔 0.5mm", "黑色", "30", "盒", "18", "540"],
    ["", "运费", "", "", "", "", "150"],
    ["", "合计", "", "", "", "", "2090"],
  ];

  it("抽取供应商与日期", () => {
    const pq = structureFromRows(rows);
    expect(pq.supplierName).toBe("上海晨光文具股份有限公司");
    expect(pq.quoteDate).toBe("2026-07-20");
    expect(pq.validUntil).toBe("2026-08-20");
  });

  it("抽取行项目（名称/数量/单价/小计/单位/规格）", () => {
    const pq = structureFromRows(rows);
    expect(pq.items).toHaveLength(2);
    expect(pq.items[0]).toMatchObject({
      originalName: "A4复印纸 70g",
      spec: "70g/m²",
      quantity: 50,
      unit: "包",
      unitPrice: 28,
      subtotal: 1400,
    });
    expect(pq.items[1]).toMatchObject({
      originalName: "中性笔 0.5mm",
      quantity: 30,
      unitPrice: 18,
      subtotal: 540,
    });
  });

  it("抽取运费与总价", () => {
    const pq = structureFromRows(rows);
    expect(pq.shippingFee).toBe(150);
    expect(pq.shippingStatus).toBe("separate");
    expect(pq.totalPrice).toBe(2090);
  });

  it("无小计列时由 数量×单价 推导", () => {
    const noAmount = [
      ["名称", "数量", "单价"],
      ["A4纸", "50", "28"],
    ];
    const pq = structureFromRows(noAmount);
    expect(pq.items[0].subtotal).toBe(1400);
  });
});

// ------------------------------------------------------------
// structureFromPdfLines（PDF 启发式）
// ------------------------------------------------------------
describe("structureFromPdfLines", () => {
  const lines = [
    "得力集团有限公司",
    "报价日期：2026-07-21",
    "名称 数量 单价 金额",
    "复印纸 70g 50 25 1250",
    "签字笔 30 15 450",
    "合计 1700",
  ];

  it("从文本行还原行项目", () => {
    const pq = structureFromPdfLines(lines);
    expect(pq.supplierName).toBe("得力集团有限公司");
    expect(pq.items.length).toBeGreaterThanOrEqual(2);
    const copy = pq.items.find((i) => i.originalName.includes("复印纸"));
    expect(copy).toMatchObject({ quantity: 50, unitPrice: 25, subtotal: 1250 });
  });

  it("识别总价", () => {
    const pq = structureFromPdfLines(lines);
    expect(pq.totalPrice).toBe(1700);
  });
});
