// ============================================================
// 报价齐 · 百炼 AI 抽取「联调测试」（默认跳过）
// ------------------------------------------------------------
// 仅在同时设置 RUN_LIVE_AI=1 与 DASHSCOPE_API_KEY 时运行，
// 会真实调用百炼 qwen-long 接口并产生少量调用费用。
// 运行示例（PowerShell）：
//   $env:DASHSCOPE_API_KEY="sk-xxx"; $env:RUN_LIVE_AI="1";
//   npx vitest run src/lib/extract/ai-provider.live.test.ts
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bailianProvider } from "./ai-provider";
import type { ExtractionInput } from "./types";

const RUN = Boolean(process.env.RUN_LIVE_AI) && Boolean(process.env.DASHSCOPE_API_KEY);

function loadInput(relPath: string, fileName: string): ExtractionInput {
  const abs = resolve(process.cwd(), relPath);
  const buf = readFileSync(abs);
  return {
    fileName,
    fileType: "xlsx",
    fileSize: buf.byteLength,
    data: new Uint8Array(buf),
  };
}

describe.skipIf(!RUN)("bailianProvider 联调（真实 API）", () => {
  it(
    "从 Excel 报价单抽取结构化数据",
    { timeout: 150_000 },
    async () => {
      const input = loadInput("scripts/test-quote-a.xlsx", "test-quote-a.xlsx");
      const result = await bailianProvider.extract(input);

      expect(result.providerId).toBe("bailian");
      expect(result.parsed).toBe(true);
      const doc = result.document;
      // 供应商应被识别（晨光）
      expect(doc.supplier.originalName).toContain("晨光");
      // 应抽取到行项目
      expect(doc.lineItems.length).toBeGreaterThan(0);
      // 至少有一行带单价
      expect(doc.lineItems.some((li) => li.unitPrice != null)).toBe(true);
      // 打印摘要便于人工核对
      console.log(
        "[live] supplier=",
        doc.supplier.originalName,
        "items=",
        doc.lineItems.length,
        "total=",
        doc.totalPrice
      );
    }
  );
});
