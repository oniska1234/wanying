// ============================================================
// 报价齐 · 抽取客户端（前端 → /api/extract）
// ============================================================

import type { ComparisonProject, UploadFile } from "./quote-types";

/**
 * 上传文件并请求服务端抽取，返回组装好的对比项目。
 * @param files      已通过校验的上传文件
 * @param providerId 抽取提供器（默认 "rule" 本地规则解析）
 */
export async function extractProject(
  files: UploadFile[],
  providerId = "rule"
): Promise<ComparisonProject> {
  const fd = new FormData();
  fd.append("provider", providerId);
  for (const f of files) {
    fd.append("files", f.file, f.name);
  }

  const res = await fetch("/api/extract", { method: "POST", body: fd });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore parse error */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ComparisonProject;
}
