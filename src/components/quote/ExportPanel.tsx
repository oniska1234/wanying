"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, Printer, CheckCircle2, AlertTriangle } from "lucide-react";
import { exportToExcel, exportToCSV } from "@/lib/quote-utils";
import type { ComparisonProject } from "@/lib/quote-types";

interface Props {
  project: ComparisonProject;
}

export default function ExportPanel({ project }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const pendingGroups = project.matchGroups.filter(
    (g) => g.status === "possible" && !g.userConfirmed
  );

  const notify = (fileName: string) => {
    setToast(fileName);
    window.setTimeout(() => setToast(null), 4000);
  };

  const handleExcel = () => notify(exportToExcel(project));
  const handleCSV = () => notify(exportToCSV(project));
  const handlePrint = () => window.print();

  return (
    <div className="space-y-6">
      {/* success toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-pine/30 bg-card px-4 py-3 text-sm font-semibold text-pine shadow-lg">
          <CheckCircle2 size={16} />
          已导出：{toast}
        </div>
      )}
      {/* 待确认匹配提醒（P2-1） */}
      {pendingGroups.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            尚有 <span className="font-bold">{pendingGroups.length} 组「待确认」匹配</span>
            未经人工确认。导出结果将包含这些未确认组，建议在导出前返回「匹配复核」确认或拆分。
          </p>
        </div>
      )}

      <div className="rounded-xl border border-ink/10 bg-card p-6">
        <h3 className="text-lg font-bold">导出对比结果</h3>
        <p className="mt-1 text-sm text-muted">
          {project.providerId === "bailian"
            ? "导出文件在本地生成；此前百炼 AI 抽取时文件内容曾上传至阿里云百炼（DashScope）qwen-long，临时文件已请求删除、不用于训练。"
            : "所有数据均在本地生成，不会上传服务器。"}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {/* Excel */}
          <button
            onClick={handleExcel}
            className="group flex flex-col items-center gap-3 rounded-xl border border-ink/10 p-6 transition-all hover:-translate-y-1 hover:border-pine/30 hover:shadow-lg"
          >
            <span className="grid h-12 w-12 place-items-center rounded-lg bg-pine/10 text-pine transition-transform group-hover:scale-110">
              <FileSpreadsheet size={24} />
            </span>
            <span className="font-bold">Excel</span>
            <span className="text-xs text-muted">多 Sheet 工作簿</span>
          </button>

          {/* CSV */}
          <button
            onClick={handleCSV}
            className="group flex flex-col items-center gap-3 rounded-xl border border-ink/10 p-6 transition-all hover:-translate-y-1 hover:border-[#3b5bdb]/30 hover:shadow-lg"
          >
            <span className="grid h-12 w-12 place-items-center rounded-lg bg-[#3b5bdb]/10 text-[#3b5bdb] transition-transform group-hover:scale-110">
              <FileText size={24} />
            </span>
            <span className="font-bold">CSV</span>
            <span className="text-xs text-muted">横向对比表</span>
          </button>

          {/* PDF / Print */}
          <button
            onClick={handlePrint}
            className="group flex flex-col items-center gap-3 rounded-xl border border-ink/10 p-6 transition-all hover:-translate-y-1 hover:border-gold/30 hover:shadow-lg"
          >
            <span className="grid h-12 w-12 place-items-center rounded-lg bg-gold/10 text-gold transition-transform group-hover:scale-110">
              <Printer size={24} />
            </span>
            <span className="font-bold">PDF / 打印</span>
            <span className="text-xs text-muted">浏览器打印为 PDF</span>
          </button>
        </div>
      </div>

      {/* brand notice */}
      <div className="rounded-lg border border-dashed border-ink/15 bg-paper-2/60 px-4 py-3 text-center text-xs text-muted">
        免费版导出包含「报价齐」品牌标识 · 升级专业版可去除
      </div>

      {/* project summary */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink/50">
          项目摘要
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "项目名称", value: project.name },
            { label: "供应商数", value: `${project.documents.filter((d) => d.analyzed !== false).length} 家` },
            { label: "比较项目", value: `${project.matchGroups.length} 组` },
            { label: "异常/待确认", value: `${project.anomalies.length} 项` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-paper/60 px-3 py-2">
              <p className="text-xs text-muted">{s.label}</p>
              <p className="mt-0.5 font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
