// ============================================================
// 报价齐 · 抽取 API（POST /api/extract）
// ------------------------------------------------------------
// 接收 multipart 上传的报价文件 + 提供器 id，服务端执行抽取，
// 返回组装好的对比项目（QuoteDocument[] + 匹配组 + 异常）。
// 默认提供器为「本地规则解析」；可通过 provider=bailian 切换（需密钥）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runExtraction } from "@/lib/extract";
import type { ExtractionInput } from "@/lib/extract";
import { assembleProject } from "@/lib/quote-utils";
import { clusterItemsWithAi } from "@/lib/extract/match-ai";
import type { FileType, MatchGroup, QuoteDocument } from "@/lib/quote-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ANALYZED = 3;

function extToType(name: string): FileType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  return "pdf";
}

/** 超出深度分析上限的文件：仅做质量检查，不纳入对比 */
function qualityOnlyDoc(
  fileName: string,
  fileType: FileType,
  fileSize: number,
  index: number
): QuoteDocument {
  const notes: string[] = ["每次最多深度分析 3 份，此文件未纳入对比"];
  let qualityStatus: QuoteDocument["qualityStatus"] = "pass";
  let hasTextLayer = true;
  let pageCount = 1;
  if (fileSize === 0) {
    qualityStatus = "fail";
    notes.unshift("空白文件，未检测到任何内容");
    hasTextLayer = false;
    pageCount = 0;
  } else if (fileType === "jpg" || fileType === "png") {
    qualityStatus = "warning";
    notes.unshift("图片格式需 OCR 识别");
    hasTextLayer = false;
  }
  return {
    id: `doc-extra-${index}`,
    projectId: "",
    fileName,
    fileType,
    fileSize,
    pageCount,
    hasTextLayer,
    qualityStatus,
    qualityNotes: notes,
    analyzed: false,
    supplier: {
      id: `sup-extra-${index}`,
      originalName: "（未纳入分析）",
      normalizedName: "（未纳入分析）",
    },
    quoteDate: null,
    validUntil: null,
    currency: "CNY",
    taxInclusive: null,
    taxRate: null,
    totalPrice: null,
    shippingFee: null,
    shippingStatus: "unknown",
    deliveryDays: null,
    paymentTerms: null,
    warranty: null,
    lineItems: [],
    fieldConfidence: {},
  };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const providerId = String(form.get("provider") ?? "rule");
    const rawFiles = form.getAll("files");
    const files = rawFiles.filter(
      (f): f is File => typeof File !== "undefined" && f instanceof File
    );

    if (!files.length) {
      return NextResponse.json({ error: "未收到任何文件" }, { status: 400 });
    }

    const projectId = `proj-${Date.now()}`;
    const analyzedFiles = files.slice(0, MAX_ANALYZED);

    const inputs: ExtractionInput[] = [];
    for (const f of analyzedFiles) {
      const data = new Uint8Array(await f.arrayBuffer());
      inputs.push({
        fileName: f.name,
        fileType: extToType(f.name),
        fileSize: f.size,
        data,
      });
    }

    const analyzedDocs = await runExtraction(inputs, providerId, projectId);
    const extraDocs = files
      .slice(MAX_ANALYZED)
      .map((f, i) => qualityOnlyDoc(f.name, extToType(f.name), f.size, i));

    // 百炼模式：额外用 AI 做跨供应商同义归组（最佳努力，失败回退本地匹配）。
    // 返回结果在 assembleProject 内仍会经硬冲突隔离安全网校验。
    let aiMatchGroups: MatchGroup[] | undefined;
    if (providerId === "bailian" && process.env.DASHSCOPE_API_KEY) {
      aiMatchGroups =
        (await clusterItemsWithAi(analyzedDocs, process.env.DASHSCOPE_API_KEY)) ??
        undefined;
    }

    const project = assembleProject([...analyzedDocs, ...extraDocs], {
      name: "报价比价项目",
      demoMode: false,
      projectId,
      providerId,
      matchGroups: aiMatchGroups,
    });

    return NextResponse.json(project);
  } catch (e) {
    return NextResponse.json(
      { error: `抽取失败：${(e as Error).message}` },
      { status: 500 }
    );
  }
}
