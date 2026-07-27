import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  toNum,
  normalizeTaxRate,
  extractJson,
  mapAiToDraft,
  hasOcrArtifact,
  repairOcrSplinter,
  attachXlsxEvidenceLocation,
} from "./ai-provider";
import { locateTextInWorkbook } from "./parse-xlsx";
import type { ExtractionInput } from "./types";

const input: ExtractionInput = {
  fileName: "晨光报价单.xlsx",
  fileType: "xlsx",
  fileSize: 1234,
  data: new Uint8Array([1, 2, 3]),
};

describe("toNum", () => {
  it("解析纯数字", () => {
    expect(toNum(28)).toBe(28);
    expect(toNum("28.5")).toBe(28.5);
  });
  it("去除货币符号与千分位", () => {
    expect(toNum("¥1,234.56")).toBe(1234.56);
    expect(toNum("￥ 99")).toBe(99);
  });
  it("非法值返回 null", () => {
    expect(toNum(null)).toBeNull();
    expect(toNum("")).toBeNull();
    expect(toNum("无")).toBeNull();
    expect(toNum(NaN)).toBeNull();
  });
});

describe("normalizeTaxRate", () => {
  it("兼容小数写法", () => {
    expect(normalizeTaxRate(0.13)).toBe(0.13);
  });
  it("兼容百分数写法", () => {
    expect(normalizeTaxRate(13)).toBe(0.13);
    expect(normalizeTaxRate("13%")).toBe(0.13);
  });
  it("非法返回 null", () => {
    expect(normalizeTaxRate(null)).toBeNull();
    expect(normalizeTaxRate("无")).toBeNull();
  });
});

describe("extractJson", () => {
  it("从代码块中提取 JSON", () => {
    const text = '```json\n{"supplierName": "甲公司"}\n```';
    expect(extractJson(text).supplierName).toBe("甲公司");
  });
  it("从含前后文本中提取 JSON", () => {
    const text = '结果如下：{"totalPrice": 100} 以上。';
    expect(extractJson(text).totalPrice).toBe(100);
  });
  it("无 JSON 时抛出", () => {
    expect(() => extractJson("没有任何对象")).toThrow();
  });
});

describe("mapAiToDraft", () => {
  it("映射完整报价单", () => {
    const draft = mapAiToDraft(input, {
      supplierName: "上海晨光文具股份有限公司",
      quoteDate: "2026-07-20",
      validUntil: "2026-08-20",
      currency: "CNY",
      taxInclusive: true,
      taxRate: 13,
      totalPrice: 2590,
      shippingFee: 100,
      shippingStatus: "separate",
      deliveryDays: 7,
      items: [
        {
          name: "A4复印纸 70g",
          spec: "70g/m²",
          brand: "晨光",
          quantity: 50,
          unit: "包",
          unitPrice: 28,
          subtotal: 1400,
        },
        {
          name: "中性笔 0.5mm",
          quantity: 100,
          unitPrice: 1.5,
        },
      ],
    });

    expect(draft.supplier.originalName).toBe("上海晨光文具股份有限公司");
    expect(draft.supplier.normalizedName).toBe("上海晨光文具股份有限公司");
    expect(draft.quoteDate).toBe("2026-07-20");
    expect(draft.validUntil).toBe("2026-08-20");
    expect(draft.taxInclusive).toBe(true);
    expect(draft.taxRate).toBe(0.13);
    expect(draft.totalPrice).toBe(2590);
    expect(draft.shippingFee).toBe(100);
    expect(draft.shippingStatus).toBe("separate");
    expect(draft.qualityStatus).toBe("pass");
    expect(draft.lineItems).toHaveLength(2);
    // 第二行未给小计，应按 数量×单价 补齐
    expect(draft.lineItems[1].subtotal).toBe(150);
    expect(draft.lineItems[0].confidence).toBe("high");
  });

  it("有效期等于报价日时视为未识别", () => {
    const draft = mapAiToDraft(input, {
      supplierName: "甲公司",
      quoteDate: "2026-07-20",
      validUntil: "2026-07-20",
      items: [],
    });
    expect(draft.validUntil).toBeNull();
  });

  it("无供应商时回退到文件名推断", () => {
    const draft = mapAiToDraft(input, { items: [] });
    expect(draft.supplier.originalName).toBe("晨光");
    expect(draft.qualityStatus).toBe("warning");
  });

  it("过滤空名称行项目", () => {
    const draft = mapAiToDraft(input, {
      supplierName: "甲公司",
      items: [{ name: "" }, { name: "有效项", unitPrice: 10 }],
    });
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0].originalName).toBe("有效项");
  });
});

// ------------------------------------------------------------
// P2-01 / P2-02：图片文本层与 OCR 断词置信度
// ------------------------------------------------------------
describe("hasOcrArtifact (P2-02)", () => {
  it("识别报告中的断词伪影", () => {
    expect(hasOcrArtifact("HDM I")).toBe(true);
    expect(hasOcrArtifact("W i-F i")).toBe(true);
    expect(hasOcrArtifact("Sw itch")).toBe(true);
    expect(hasOcrArtifact("W ire less")).toBe(true);
  });
  it("正常名称不误报", () => {
    expect(hasOcrArtifact("A4复印纸 70g")).toBe(false);
    expect(hasOcrArtifact("ThinkBook 14+")).toBe(false);
    expect(hasOcrArtifact("黑色中性笔")).toBe(false);
    expect(hasOcrArtifact("A4 Copy Paper")).toBe(false);
  });
});

describe("mapAiToDraft quality (P2-01/P2-02)", () => {
  it("图片文件 hasTextLayer=false 且提示 OCR", () => {
    const imgInput: ExtractionInput = {
      fileName: "报价.png",
      fileType: "png",
      fileSize: 999,
      data: new Uint8Array([1]),
    };
    const draft = mapAiToDraft(imgInput, {
      supplierName: "甲公司",
      items: [{ name: "A4复印纸", unitPrice: 28 }],
    });
    expect(draft.hasTextLayer).toBe(false);
    expect(draft.qualityNotes.some((n) => n.includes("OCR") || n.includes("视觉模型"))).toBe(true);
  });

  it("PDF/Excel 文件 hasTextLayer=true", () => {
    const draft = mapAiToDraft(input, { supplierName: "甲", items: [{ name: "笔", unitPrice: 1 }] });
    expect(draft.hasTextLayer).toBe(true);
  });

  it("OCR 断词行降为中置信度且质量状态为 warning，名称已修复", () => {
    const imgInput: ExtractionInput = {
      fileName: "报价.png",
      fileType: "png",
      fileSize: 999,
      data: new Uint8Array([1]),
    };
    const draft = mapAiToDraft(imgInput, {
      supplierName: "甲公司",
      items: [
        { name: "HDM I 线", unitPrice: 20 },
        { name: "A4复印纸", unitPrice: 28 },
      ],
    });
    // 名称应被修复为 HDMI
    expect(draft.lineItems[0].originalName).toBe("HDMI 线");
    // 但置信度仍为中（AI 推断 + 曾有伪影）
    expect(draft.lineItems[0].confidence).toBe("medium");
    expect(draft.lineItems[1].confidence).toBe("high");
    expect(draft.qualityStatus).toBe("warning");
    // aiValues 保留原始值
    expect(draft.lineItems[0].aiValues?.originalName).toBe("HDM I 线");
  });
});

// ------------------------------------------------------------
// P2-4 第三轮：OCR 断词修复
// ------------------------------------------------------------
describe("repairOcrSplinter (P2-4)", () => {
  it("修复已知术语：HDM I → HDMI", () => {
    expect(repairOcrSplinter("HDM I")).toBe("HDMI");
  });
  it("修复已知术语：W i-F i → Wi-Fi", () => {
    expect(repairOcrSplinter("W i-F i")).toBe("Wi-Fi");
  });
  it("修复已知术语：Sw itch → Switch", () => {
    expect(repairOcrSplinter("Sw itch")).toBe("Switch");
  });
  it("修复已知术语：W ire less → Wireless", () => {
    expect(repairOcrSplinter("W ire less")).toBe("Wireless");
  });
  it("保留尾部 token：W ire less AP → Wireless AP", () => {
    expect(repairOcrSplinter("W ire less AP")).toBe("Wireless AP");
  });
  it("带中文上下文：HDM I 线 → HDMI 线", () => {
    expect(repairOcrSplinter("HDM I 线")).toBe("HDMI 线");
  });
  it("保留尾部型号：Sw itch 24 → Switch 24", () => {
    expect(repairOcrSplinter("Sw itch 24")).toBe("Switch 24");
  });
  it("修复规格串：W i-F i 6 AX3000 → Wi-Fi 6 AX3000", () => {
    expect(repairOcrSplinter("W i-F i 6 AX3000")).toBe("Wi-Fi 6 AX3000");
  });
  it("字符级合并：HDM I+DP 粘连（第六轮 P2-01）", () => {
    expect(repairOcrSplinter("2K IPS/ 100Hz/ HDM I+DP")).toBe("2K IPS/ 100Hz/ HDMI+DP");
  });
  it("字符级合并：D isplay Port → DisplayPort", () => {
    expect(repairOcrSplinter("D isplay Port")).toBe("DisplayPort");
  });
  it("字符级合并：U SB-C → USB-C", () => {
    expect(repairOcrSplinter("U SB-C")).toBe("USB-C");
  });
  it("正常写法不被误改：HDMI+DP / Wi-Fi / USB-C", () => {
    expect(repairOcrSplinter("2K IPS/ 100Hz/ HDMI+DP")).toBe("2K IPS/ 100Hz/ HDMI+DP");
    expect(repairOcrSplinter("Wi-Fi 6 AX3000")).toBe("Wi-Fi 6 AX3000");
    expect(repairOcrSplinter("USB-C 扩展坞")).toBe("USB-C 扩展坞");
  });
  it("正常名称不变", () => {
    expect(repairOcrSplinter("A4复印纸 70g")).toBe("A4复印纸 70g");
    expect(repairOcrSplinter("ThinkBook 14+")).toBe("ThinkBook 14+");
    expect(repairOcrSplinter("A4 Copy Paper")).toBe("A4 Copy Paper");
    expect(repairOcrSplinter("黑色中性笔")).toBe("黑色中性笔");
  });
});

// ------------------------------------------------------------
// P2-01 第五轮：规格字段的 OCR 断词也应修复
// ------------------------------------------------------------
describe("mapAiToDraft spec repair (第五轮 P2-01)", () => {
  it("规格字段断词被修复，aiValues 保留原始值", () => {
    const imgInput: ExtractionInput = {
      fileName: "报价.png",
      fileType: "png",
      fileSize: 999,
      data: new Uint8Array([1]),
    };
    const draft = mapAiToDraft(imgInput, {
      supplierName: "甲公司",
      items: [
        { name: "W ire less AP", spec: "W i-F i 6 AX3000", unitPrice: 430 },
      ],
    });
    expect(draft.lineItems[0].originalName).toBe("Wireless AP");
    expect(draft.lineItems[0].spec).toBe("Wi-Fi 6 AX3000");
    // 审计链：aiValues 保留模型原始输出
    expect(draft.lineItems[0].aiValues?.originalName).toBe("W ire less AP");
    expect(draft.lineItems[0].aiValues?.spec).toBe("W i-F i 6 AX3000");
  });

  it("正常规格不受影响", () => {
    const draft = mapAiToDraft(input, {
      supplierName: "甲公司",
      items: [{ name: "A4复印纸", spec: "70g/m²", unitPrice: 28 }],
    });
    expect(draft.lineItems[0].spec).toBe("70g/m²");
  });
});

// ------------------------------------------------------------
// P2-01 第七轮：Excel 证据精确定位（工作表名 + 单元格区域）
// ------------------------------------------------------------
function buildWorkbookBytes(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([
    ["序号", "名称", "规格", "数量", "单价"],
    [1, "笔记本电脑 8GB版本", "i5/8GB/512GB", 3, 4599],
    [2, "27英寸显示器", "2K IPS/100Hz", 5, 1080],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "报价明细");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(buf);
}

describe("locateTextInWorkbook (第七轮 P2-01)", () => {
  const data = buildWorkbookBytes();

  it("定位到工作表名与行区域", () => {
    const loc = locateTextInWorkbook(data, "27英寸显示器");
    expect(loc).not.toBeNull();
    expect(loc!.sheetName).toBe("报价明细");
    expect(loc!.cell).toBe("A3:E3");
  });

  it("目标串含单元格文本时也能命中（AI 可能拼接后缀）", () => {
    const loc = locateTextInWorkbook(data, "笔记本电脑 8GB版本 16GB升级");
    expect(loc?.cell).toBe("A2:E2");
  });

  it("未命中返回 null，非法数据不抛异常", () => {
    expect(locateTextInWorkbook(data, "不存在的商品")).toBeNull();
    expect(locateTextInWorkbook(new Uint8Array([1, 2, 3]), "显示器")).toBeNull();
    expect(locateTextInWorkbook(data, "")).toBeNull();
  });
});

describe("attachXlsxEvidenceLocation (第七轮 P2-01)", () => {
  it("xlsx 来源回填 sheetName + cell", () => {
    const xlsxInput: ExtractionInput = {
      fileName: "供应商B_8GB版本.xlsx",
      fileType: "xlsx",
      fileSize: 999,
      data: buildWorkbookBytes(),
    };
    const draft = mapAiToDraft(xlsxInput, {
      supplierName: "供应商B",
      items: [
        { name: "27英寸显示器", unitPrice: 1080 },
        { name: "不在表中的项", unitPrice: 1 },
      ],
    });
    attachXlsxEvidenceLocation(draft, xlsxInput);
    expect(draft.lineItems[0].evidence[0].sheetName).toBe("报价明细");
    expect(draft.lineItems[0].evidence[0].cell).toBe("A3:E3");
    // 未命中项保持无定位，不影响主流程
    expect(draft.lineItems[1].evidence[0].cell).toBeUndefined();
  });

  it("非 Excel 文件不处理", () => {
    const pdfInput: ExtractionInput = {
      fileName: "报价.pdf",
      fileType: "pdf",
      fileSize: 999,
      data: buildWorkbookBytes(),
    };
    const draft = mapAiToDraft(pdfInput, {
      supplierName: "甲",
      items: [{ name: "27英寸显示器", unitPrice: 1080 }],
    });
    attachXlsxEvidenceLocation(draft, pdfInput);
    expect(draft.lineItems[0].evidence[0].cell).toBeUndefined();
  });
});
