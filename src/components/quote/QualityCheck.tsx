"use client";

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Btn } from "@/components/ui";
import type { QuoteDocument } from "@/lib/quote-types";

interface Props {
  documents: QuoteDocument[];
  onContinue: () => void;
}

export default function QualityCheck({ documents, onContinue }: Props) {
  const allPass = documents.every((d) => d.qualityStatus !== "fail");

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-[#3b5bdb]/5 px-4 py-3 text-sm text-[#3b5bdb]">
        文件质量检查完成，{documents.length} 份文件已验证。
        {!allPass && " 部分文件存在问题，请查看下方详情。"}
      </div>

      <div className="space-y-3">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={`rounded-xl border p-4 ${
              doc.qualityStatus === "pass"
                ? "border-pine/30 bg-pine/5"
                : doc.qualityStatus === "warning"
                  ? "border-gold/30 bg-gold/5"
                  : "border-accent/30 bg-accent/5"
            }`}
          >
            <div className="flex items-center gap-3">
              {doc.qualityStatus === "pass" ? (
                <CheckCircle2 size={20} className="text-pine" />
              ) : doc.qualityStatus === "warning" ? (
                <AlertTriangle size={20} className="text-gold" />
              ) : (
                <XCircle size={20} className="text-accent" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{doc.fileName}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>类型：{doc.fileType.toUpperCase()}</span>
                  <span>页数：{doc.pageCount}</span>
                  <span>文本层：{doc.hasTextLayer ? "有" : "无（需OCR）"}</span>
                  <span>大小：{(doc.fileSize / 1024).toFixed(0)} KB</span>
                </div>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                  doc.qualityStatus === "pass"
                    ? "bg-pine/10 text-pine"
                    : doc.qualityStatus === "warning"
                      ? "bg-gold/10 text-gold"
                      : "bg-accent/10 text-accent"
                }`}
              >
                {doc.qualityStatus === "pass" ? "通过" : doc.qualityStatus === "warning" ? "警告" : "失败"}
              </span>
            </div>

            {doc.qualityNotes.length > 0 && (
              <ul className="mt-3 space-y-1 pl-8 text-sm text-muted">
                {doc.qualityNotes.map((note, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-gold" />
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {allPass && (
        <div className="flex justify-end">
          <Btn onClick={onContinue}>确认，进入抽取复核 →</Btn>
        </div>
      )}
    </div>
  );
}
