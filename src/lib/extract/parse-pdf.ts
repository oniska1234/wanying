// ============================================================
// 报价齐 · PDF 文本层解析（pdfjs-dist legacy 构建）
// ------------------------------------------------------------
// - 使用 legacy/build/pdf.mjs（Node 友好），通过动态 import 引入，
//   配合 next.config 的 serverExternalPackages 避免打包 worker。
// - 将文本项按 y 坐标聚行、行内按 x 排序，还原阅读顺序。
// - 解析失败由调用方捕获并降级为「需人工录入」。
// ============================================================

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

export interface PdfTextResult {
  pageCount: number;
  hasTextLayer: boolean;
  lines: string[];
}

export async function readPdfText(data: Uint8Array): Promise<PdfTextResult> {
  // 动态引入，避免客户端打包问题
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const pageCount: number = doc.numPages ?? 0;
  const lines: string[] = [];
  let charCount = 0;

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items ?? []) as PdfTextItem[];

    // 按 y 聚行（PDF 坐标 y 自下而上）
    const byLine = new Map<number, { x: number; s: string }[]>();
    for (const it of items) {
      const s = it.str;
      if (!s || !it.transform) continue;
      charCount += s.length;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      const arr = byLine.get(y) ?? [];
      arr.push({ x, s });
      byLine.set(y, arr);
    }

    // 自上而下输出各行，行内自左而右
    const ys = [...byLine.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const line = byLine
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((t) => t.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) lines.push(line);
    }
    page.cleanup();
  }

  await loadingTask.destroy();
  return { pageCount, hasTextLayer: charCount > 0, lines };
}
