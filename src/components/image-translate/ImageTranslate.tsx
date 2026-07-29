"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Upload, Download, RefreshCw, X, XCircle, Loader2, ImageIcon } from "lucide-react";

interface TaskItem {
  id: string;
  file_name: string;
  status: string;
  source_url: string | null;
  output_url: string | null;
  error: string | null;
}

interface TaskInfo {
  id: string;
  status: string;
  total_count: number;
  done_count: number;
  failed_count: number;
  created_at: string;
}

interface TaskDetail extends TaskInfo {
  items: TaskItem[];
}

export default function ImageTranslate() {
  const { status: authStatus } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskDetail | null>(null);
  const [history, setHistory] = useState<TaskInfo[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/image-translate/tasks?page=1&page_size=20");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.items || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated") loadHistory();
  }, [authStatus, loadHistory]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const pollTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/image-translate/task/${taskId}`);
      if (!res.ok) return;
      const data: TaskDetail = await res.json();
      setCurrentTask(data);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        loadHistory();
      }
    } catch { /* ignore */ }
  }, [loadHistory]);

  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollTask(taskId);
    pollRef.current = setInterval(() => pollTask(taskId), 3000);
  }, [pollTask]);

  const handleFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) =>
      /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name)
    );
    setFiles((prev) => [...prev, ...arr].slice(0, 50));
    setError("");
  };

  const submitTask = async () => {
    if (!files.length) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    try {
      const res = await fetch("/api/image-translate/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "提交失败"); return; }
      setFiles([]);
      setCurrentTask({ id: data.task_id, status: "processing", total_count: data.total, done_count: 0, failed_count: 0, created_at: new Date().toISOString(), items: [] });
      startPolling(data.task_id);
    } catch { setError("网络错误"); }
    finally { setUploading(false); }
  };

  const viewTask = async (taskId: string) => {
    const res = await fetch(`/api/image-translate/task/${taskId}`);
    if (res.ok) {
      const data: TaskDetail = await res.json();
      setCurrentTask(data);
      if (data.status === "processing") startPolling(taskId);
    }
  };

  const progress = currentTask && currentTask.total_count > 0
    ? Math.round(((currentTask.done_count + currentTask.failed_count) / currentTask.total_count) * 100)
    : 0;

  if (authStatus === "loading") return <div className="py-20 text-center text-muted">加载中...</div>;
  if (authStatus !== "authenticated") return <div className="py-20 text-center text-muted">请先登录后使用此工具</div>;

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <section className="rounded-xl border border-line bg-card p-5">
        <div
          className={`relative grid place-items-center rounded-lg border-2 border-dashed p-10 transition-colors ${dragOver ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mb-3 text-muted" size={32} />
          <p className="text-sm text-muted">拖拽图片到此处，或点击选择</p>
          <p className="mt-1 text-xs text-muted/60">支持 JPG / PNG / WebP / BMP / TIFF，单次最多 50 张</p>
          <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>

        {files.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs">
                  <ImageIcon size={12} /> {f.name.length > 20 ? f.name.slice(0, 18) + "…" : f.name}
                  <button onClick={(e) => { e.stopPropagation(); setFiles((p) => p.filter((_, j) => j !== i)); }} className="ml-1 text-muted hover:text-red-500"><X size={12} /></button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button onClick={submitTask} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                开始翻译 ({files.length} 张)
              </button>
              <button onClick={() => setFiles([])} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:bg-surface">清空</button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </section>

      {/* Progress */}
      {currentTask && (
        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">处理进度</h3>
            <StatusBadge status={currentTask.status} />
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface">
            <div className={`h-full rounded-full transition-all ${currentTask.status === "failed" ? "bg-red-500" : "bg-accent"}`} style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">完成 {currentTask.done_count} · 失败 {currentTask.failed_count} · 总计 {currentTask.total_count}</p>

          {currentTask.items && currentTask.items.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {currentTask.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    {item.source_url && <img src={item.source_url} alt="原图" className="h-16 w-16 rounded object-contain border border-line" />}
                    <span className="text-muted">→</span>
                    {item.output_url ? <img src={item.output_url} alt="译图" className="h-16 w-16 rounded object-contain border border-line" /> : item.status === "failed" ? <XCircle className="text-red-400" size={24} /> : <Loader2 className="animate-spin text-muted" size={24} />}
                  </div>
                  <p className="mt-2 truncate text-xs text-muted">{item.file_name}</p>
                </div>
              ))}
            </div>
          )}

          {currentTask.status === "done" && (
            <a href={`/api/image-translate/download/${currentTask.id}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
              <Download size={16} /> 打包下载 ZIP
            </a>
          )}
        </section>
      )}

      {/* History */}
      <section className="rounded-xl border border-line bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">历史记录</h3>
          <button onClick={loadHistory} className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><RefreshCw size={12} /> 刷新</button>
        </div>
        {history.length === 0 ? (
          <p className="mt-4 text-sm text-muted">暂无记录</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">进度</th><th className="pb-2 pr-4">时间</th><th className="pb-2">操作</th>
              </tr></thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.id} className="border-b border-line/50">
                    <td className="py-2 pr-4"><StatusBadge status={t.status} /></td>
                    <td className="py-2 pr-4">{t.done_count}/{t.total_count}{t.failed_count > 0 && <span className="text-red-500"> ({t.failed_count}失败)</span>}</td>
                    <td className="py-2 pr-4 text-xs text-muted">{new Date(t.created_at).toLocaleString("zh-CN")}</td>
                    <td className="py-2">
                      <button onClick={() => viewTask(t.id)} className="mr-2 text-xs text-accent hover:underline">查看</button>
                      {t.status === "done" && <a href={`/api/image-translate/download/${t.id}`} className="text-xs text-green-600 hover:underline">下载</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "等待中", cls: "bg-gray-100 text-gray-600" },
    processing: { label: "处理中", cls: "bg-amber-100 text-amber-700" },
    done: { label: "已完成", cls: "bg-green-100 text-green-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status] || map.pending;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
