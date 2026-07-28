"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

interface ImportResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ row: number; field: string; message: string }>;
  quotaHit: boolean;
}

type Status = "idle" | "uploading" | "done" | "error";

export default function ImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      setErrorMsg("仅支持 .xlsx 或 .xls 格式");
      setStatus("error");
      return;
    }
    setFile(f);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const doImport = async () => {
    if (!file) return;
    setStatus("uploading");
    setResult(null);
    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/my-profit/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "导入失败");
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("done");
    } catch {
      setErrorMsg("网络错误，请重试");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-6">
      {/* 步骤说明 */}
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        {[
          { step: "1", label: "下载模板" },
          { step: "2", label: "填写商品数据" },
          { step: "3", label: "上传导入" },
        ].map((s) => (
          <div key={s.step} className="rounded-lg border border-ink/10 bg-card px-3 py-3">
            <span className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full bg-accent/10 text-xs font-bold text-accent">
              {s.step}
            </span>
            <span className="text-ink/70">{s.label}</span>
          </div>
        ))}
      </div>

      {/* 下载模板 */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h2 className="mb-2 text-sm font-bold">第一步：下载 Excel 模板</h2>
        <p className="mb-3 text-xs text-muted">
          模板包含字段说明和示例数据，按格式填写后上传即可。单次最多 100 行。
        </p>
        <a
          href="/api/my-profit/import/template"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
          下载导入模板 (.xlsx)
        </a>
      </div>

      {/* 上传区域 */}
      <div className="rounded-xl border border-ink/10 bg-card p-5">
        <h2 className="mb-3 text-sm font-bold">第二步：上传已填写的 Excel</h2>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`grid cursor-pointer place-items-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? "border-accent bg-accent/5" : "border-ink/15 hover:border-accent/50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onInputChange}
          />
          {file ? (
            <div>
              <p className="text-sm font-semibold text-ink">{file.name}</p>
              <p className="mt-1 text-xs text-muted">{(file.size / 1024).toFixed(1)} KB · 点击重新选择</p>
            </div>
          ) : (
            <div>
              <svg className="mx-auto h-10 w-10 text-ink/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="mt-2 text-sm text-ink/60">拖拽文件到此处，或点击选择</p>
              <p className="mt-1 text-xs text-muted">支持 .xlsx / .xls</p>
            </div>
          )}
        </div>

        <button
          onClick={doImport}
          disabled={!file || status === "uploading"}
          className="mt-4 w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "uploading" ? "导入中…" : "开始导入"}
        </button>
      </div>

      {/* 错误提示 */}
      {status === "error" && errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* 导入结果 */}
      {status === "done" && result && (
        <div className="rounded-xl border border-ink/10 bg-card p-5">
          <h2 className="mb-3 text-sm font-bold">导入结果</h2>

          <div className="mb-4 flex gap-4">
            <div className="rounded-lg bg-emerald-50 px-4 py-2 text-center">
              <p className="text-lg font-bold text-emerald-700">{result.success}</p>
              <p className="text-xs text-emerald-600">成功导入</p>
            </div>
            <div className="rounded-lg bg-red-50 px-4 py-2 text-center">
              <p className="text-lg font-bold text-red-700">{result.failed}</p>
              <p className="text-xs text-red-600">失败</p>
            </div>
            <div className="rounded-lg bg-ink/5 px-4 py-2 text-center">
              <p className="text-lg font-bold text-ink/70">{result.total}</p>
              <p className="text-xs text-muted">总行数</p>
            </div>
          </div>

          {result.quotaHit && (
            <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              免费版选品名额已满，超出部分未导入。升级 Pro 解锁无限选品。
            </p>
          )}

          {result.errors.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-ink/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-ink/5">
                  <tr>
                    <th className="px-3 py-2 font-semibold">行号</th>
                    <th className="px-3 py-2 font-semibold">字段</th>
                    <th className="px-3 py-2 font-semibold">错误信息</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t border-ink/5">
                      <td className="px-3 py-1.5">{e.row > 0 ? `第 ${e.row} 行` : "-"}</td>
                      <td className="px-3 py-1.5">{e.field}</td>
                      <td className="px-3 py-1.5 text-red-600">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.success > 0 && (
            <div className="mt-4 text-center">
              <Link
                href="/my-profit/list"
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/5"
              >
                查看选品清单 →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
