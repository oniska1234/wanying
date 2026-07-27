// ============================================================
// 报价齐 · Excel 解析（xlsx → 字符串表格行）
// 仅依赖 xlsx，可在 Node / 浏览器同构运行。
// ============================================================

import * as XLSX from "xlsx";

/**
 * 读取 Excel 第一个工作表，转为字符串二维数组。
 * - raw:false 使用单元格的显示格式（保留千分位 / 日期文本原貌）
 * - defval:"" 保证每行列数对齐
 */
export function readXlsxRows(data: Uint8Array): string[][] {
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  });
  return rows.map((r) => (Array.isArray(r) ? r : [r]).map((c) => String(c ?? "").trim()));
}

/** 读取所有工作表名称（调试 / 证据用） */
export function readXlsxSheetNames(data: Uint8Array): string[] {
  const wb = XLSX.read(data, { type: "array" });
  return wb.SheetNames;
}

export interface XlsxLocation {
  sheetName: string;
  /** 单元格区域，如 A5:F5（整行有效列范围） */
  cell: string;
}

/**
 * 在工作簿中定位包含指定文本的行（第七轮 P2：证据精确定位）。
 * 用于 AI 抽取后回填 Excel 来源的工作表名与单元格地址；
 * 找不到时返回 null，不影响主流程。
 */
export function locateTextInWorkbook(data: Uint8Array, needle: string): XlsxLocation | null {
  const key = needle.trim();
  if (!key) return null;
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array" });
  } catch {
    return null;
  }
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const ref = ws["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const v = ws[addr]?.v;
        if (v == null) continue;
        const s = String(v).trim();
        if (s === "") continue;
        // 单元格文本含目标串，或目标串含单元格文本（长度≥4 防短串误命中）
        const hit = s.includes(key) || (s.length >= 4 && key.includes(s));
        if (hit) {
          const rowStart = XLSX.utils.encode_cell({ r, c: range.s.c });
          const rowEnd = XLSX.utils.encode_cell({ r, c: range.e.c });
          return { sheetName, cell: `${rowStart}:${rowEnd}` };
        }
      }
    }
  }
  return null;
}
