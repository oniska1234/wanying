"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Upload, Download, RefreshCw, X, XCircle, Loader2, ImageIcon, ZoomIn, ChevronLeft, ChevronRight } from "lucide-react";

interface TaskItem {
  id: string;
  file_name: string;
  status: string;
  source_url: string | null;
  output_url: string | null;
  error: string | null;
  duration_ms?: number | null;
  cache_hit?: boolean;
}

interface TaskInfo {
  id: string;
  status: string;
  total_count: number;
  done_count: number;
  failed_count: number;
  review_count?: number;
  created_at: string;
  duration_ms?: number | null;
  average_duration_ms?: number | null;
}

interface TaskDetail extends TaskInfo {
  items: TaskItem[];
}

export default function ImageTranslate({
  apiBase = "/api/image-translate",
  outputHint,
}: {
  apiBase?: string;
  outputHint?: string;
}) {
  const { status: authStatus } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskDetail | null>(null);
  const [history, setHistory] = useState<TaskInfo[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showTiming = apiBase.includes("high-concurrency");

  const loadHistory = useCallback(async (): Promise<TaskInfo[]> => {
    try {
      const res = await fetch(`${apiBase}/tasks?page=1&page_size=20`);
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        setHistory(items);
        return items;
      }
    } catch { /* ignore */ }
    return [];
  }, [apiBase]);

  const pollTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/task/${taskId}`);
      if (res.ok) {
        const data: TaskDetail = await res.json();
        setCurrentTask(data);
        if (data.status !== "processing" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          loadHistory();
        }
      }
    } catch { /* ignore */ }
  }, [loadHistory]);

  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollTask(taskId);
    pollRef.current = setInterval(() => pollTask(taskId), 5000);
  }, [pollTask]);

  useEffect(() => {
    void loadHistory().then((tasks) => {
      const active = tasks.find((task) => task.status === "processing");
      if (active) startPolling(active.id);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadHistory, startPolling]);

  const handleFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) =>
      /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name)
    );
    // Validate file sizes before adding
    const MAX_FILE = 10 * 1024 * 1024; // 10MB
    const MAX_TOTAL = 50 * 1024 * 1024; // 50MB
    const valid = arr.filter((f) => {
      if (f.size > MAX_FILE) { setError(`文件 ${f.name} 超过 10MB 限制`); return false; }
      return true;
    });
    if (valid.length === 0) return;
    setFiles((prev) => {
      const combined = [...prev, ...valid].slice(0, 50);
      const totalSize = combined.reduce((s, f) => s + f.size, 0);
      if (totalSize > MAX_TOTAL) { setError("总大小不能超过 50MB，请减少文件"); return prev; }
      setError("");
      return combined;
    });
  };

  const submitTask = async () => {
    if (!files.length) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    try {
      const res = await fetch(`${apiBase}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "提交失败"); return; }
      setFiles([]);
      setCurrentTask({ id: data.task_id, status: "processing", total_count: data.total, done_count: 0, failed_count: 0, review_count: 0, created_at: new Date().toISOString(), duration_ms: 0, average_duration_ms: null, items: [] });
      startPolling(data.task_id);
    } catch {
      setError("服务器上传连接超时或响应中断，任务可能仍在后台处理；已自动刷新历史记录");
      await loadHistory();
    }
    finally { setUploading(false); }
  };

  const viewTask = async (taskId: string) => {
    const res = await fetch(`${apiBase}/task/${taskId}`);
    if (res.ok) {
      const data: TaskDetail = await res.json();
      setCurrentTask(data);
      if (data.status === "processing") startPolling(taskId);
    }
  };

  const progress = currentTask && currentTask.total_count > 0
    ? Math.round(((currentTask.done_count + currentTask.failed_count) / currentTask.total_count) * 100)
    : 0;

  // Previewable items (have both source and output)
  const previewItems = currentTask?.items?.filter((it) => it.source_url && it.output_url) || [];

  if (authStatus === "loading") return <div className="py-20 text-center text-muted">加载中...</div>;
  if (authStatus !== "authenticated") return <div className="py-20 text-center text-muted">请先登录后使用此工具</div>;

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <section className="rounded-xl border border-line bg-card p-5">
        {outputHint && (
          <p className="mb-4 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{outputHint}</p>
        )}
        <div
          className={`relative grid place-items-center rounded-lg border-2 border-dashed p-10 transition-colors ${dragOver ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mb-3 text-muted" size={32} />
          <p className="text-sm text-muted">拖拽图片到此处，或点击选择</p>
          <p className="mt-1 text-xs text-muted/60">支持 JPG / PNG / WebP / BMP / TIFF，单张≤10MB，总计≤50MB，最多 50 张</p>
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
          <p className="mt-2 text-xs text-muted">
            完成 {currentTask.done_count}
            {(currentTask.review_count || 0) > 0 && `（其中 ${currentTask.review_count} 张需确认）`}
            {` · 失败 ${currentTask.failed_count} · 总计 ${currentTask.total_count}`}
            {showTiming && currentTask.average_duration_ms != null && ` · 单张平均 ${formatDuration(currentTask.average_duration_ms)}`}
            {showTiming && currentTask.duration_ms != null && ` · ${currentTask.status === "processing" ? "已用时" : "本批耗时"} ${formatDuration(currentTask.duration_ms)}`}
          </p>

          {currentTask.items && currentTask.items.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {currentTask.items.map((item, idx) => (
                <div key={item.id} className="rounded-lg border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    {item.source_url && <img src={item.source_url} alt="原图" className="h-16 w-16 rounded object-contain border border-line" />}
                    <span className="text-muted">→</span>
                    {item.output_url ? <img src={item.output_url} alt="译图" className="h-16 w-16 rounded object-contain border border-line" /> : item.status === "failed" ? <XCircle className="text-red-400" size={24} /> : <Loader2 className="animate-spin text-muted" size={24} />}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="truncate text-xs text-muted">{item.file_name}</p>
                    {item.source_url && item.output_url && (
                      <button
                        onClick={() => setPreviewIndex(previewItems.findIndex((p) => p.id === item.id))}
                        className="ml-2 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-accent hover:bg-accent/10"
                        title="对比预览"
                      >
                        <ZoomIn size={12} /> 对比
                      </button>
                    )}
                  </div>
                  {item.status === "review" && (
                    <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                      需人工确认：{item.error || "源图文字清理置信度不足"}
                    </p>
                  )}
                  {item.status === "failed" && item.error && (
                    <p className="mt-2 text-xs text-red-500">{item.error}</p>
                  )}
                  {showTiming && (
                    <p className={`mt-2 text-xs ${item.cache_hit ? "text-green-600" : "text-muted"}`}>
                      {item.duration_ms != null
                        ? `${item.cache_hit ? "缓存命中 · " : "处理耗时 "}${formatDuration(item.duration_ms)}`
                        : item.status === "pending" || item.status === "processing"
                          ? "等待耗时统计"
                          : "历史任务未记录耗时"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {currentTask.status === "done" && (
            <a href={`${apiBase}/download/${currentTask.id}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
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
                <th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">进度</th>{showTiming && <th className="pb-2 pr-4">耗时</th>}<th className="pb-2 pr-4">时间</th><th className="pb-2">操作</th>
              </tr></thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.id} className="border-b border-line/50">
                    <td className="py-2 pr-4"><StatusBadge status={t.status} /></td>
                    <td className="py-2 pr-4">
                      {t.done_count}/{t.total_count}
                      {(t.review_count || 0) > 0 && <span className="text-amber-600"> ({t.review_count}需确认)</span>}
                      {t.failed_count > 0 && <span className="text-red-500"> ({t.failed_count}失败)</span>}
                    </td>
                    {showTiming && <td className="py-2 pr-4 text-xs text-muted">{t.duration_ms != null ? formatDuration(t.duration_ms) : "未记录"}</td>}
                    <td className="py-2 pr-4 text-xs text-muted">{new Date(t.created_at).toLocaleString("zh-CN")}</td>
                    <td className="py-2">
                      <button onClick={() => viewTask(t.id)} className="mr-2 text-xs text-accent hover:underline">查看</button>
                      {t.status === "done" && <a href={`${apiBase}/download/${t.id}`} className="text-xs text-green-600 hover:underline">下载</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Comparison Preview Modal */}
      {previewIndex !== null && previewItems[previewIndex] && (
        <CompareModal
          items={previewItems}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onNavigate={(i) => setPreviewIndex(i)}
        />
      )}
    </div>
  );
}

export function formatDuration(durationMs: number): string {
  const safeMs = Math.max(0, Math.round(durationMs));
  if (safeMs < 1000) return `${safeMs}毫秒`;
  if (safeMs < 60_000) {
    const seconds = safeMs / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}秒`;
  }
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.round((safeMs % 60_000) / 1000);
  return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
}

/* ─── Compare Modal with Slider ─── */
function CompareModal({ items, index, onClose, onNavigate }: {
  items: TaskItem[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const item = items[index];
  const [sliderPos, setSliderPos] = useState(50);
  const [mode, setMode] = useState<"slider" | "side">("slider");
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Reset slider when switching images
  useEffect(() => { setSliderPos(50); }, [index]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      if (e.key === "ArrowRight" && index < items.length - 1) onNavigate(index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, items.length, onClose, onNavigate]);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{item.file_name}</span>
          <span className="text-xs text-white/50">{index + 1} / {items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <button
            onClick={() => setMode(mode === "slider" ? "side" : "slider")}
            className="rounded-md border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
          >
            {mode === "slider" ? "并排对比" : "滑动对比"}
          </button>
          <button onClick={onClose} className="rounded-md p-1 text-white/80 hover:bg-white/10"><X size={20} /></button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        {/* Nav arrows */}
        {index > 0 && (
          <button onClick={() => onNavigate(index - 1)} className="absolute left-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <ChevronLeft size={24} />
          </button>
        )}
        {index < items.length - 1 && (
          <button onClick={() => onNavigate(index + 1)} className="absolute right-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <ChevronRight size={24} />
          </button>
        )}

        {mode === "slider" ? (
          /* Slider comparison mode */
          <div
            ref={containerRef}
            className="relative max-h-[75vh] max-w-[90vw] cursor-col-resize select-none overflow-hidden rounded-lg"
            onMouseDown={(e) => { dragging.current = true; handleMove(e.clientX); }}
            onMouseMove={(e) => { if (dragging.current) handleMove(e.clientX); }}
            onMouseUp={() => { dragging.current = false; }}
            onMouseLeave={() => { dragging.current = false; }}
            onTouchStart={(e) => { dragging.current = true; handleMove(e.touches[0].clientX); }}
            onTouchMove={(e) => { if (dragging.current) handleMove(e.touches[0].clientX); }}
            onTouchEnd={() => { dragging.current = false; }}
          >
            {/* Output (translated) - full background */}
            <img src={item.output_url!} alt="翻译后" className="block max-h-[75vh] w-auto max-w-full" draggable={false} />
            {/* Source (original) - clipped overlay */}
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
              <img src={item.source_url!} alt="原图" className="block h-full max-h-[75vh] w-auto max-w-none object-cover" draggable={false} style={{ minWidth: containerRef.current?.offsetWidth || "100%" }} />
            </div>
            {/* Slider line */}
            <div className="absolute inset-y-0 z-10" style={{ left: `${sliderPos}%` }}>
              <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-lg" />
              <div className="absolute top-1/2 -ml-4 -mt-4 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-white/90 shadow-lg">
                <span className="text-[10px] font-bold text-gray-700">⇔</span>
              </div>
            </div>
            {/* Labels */}
            <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">原图</span>
            <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">译文</span>
          </div>
        ) : (
          /* Side-by-side comparison mode */
          <div className="flex max-h-[75vh] max-w-[90vw] gap-4 overflow-auto">
            <div className="flex flex-col items-center">
              <span className="mb-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">原图</span>
              <img src={item.source_url!} alt="原图" className="max-h-[65vh] w-auto rounded-lg border border-white/20 object-contain" />
            </div>
            <div className="flex flex-col items-center">
              <span className="mb-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">翻译后</span>
              <img src={item.output_url!} alt="翻译后" className="max-h-[65vh] w-auto rounded-lg border border-white/20 object-contain" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "等待中", cls: "bg-gray-100 text-gray-600" },
    processing: { label: "处理中", cls: "bg-amber-100 text-amber-700" },
    done: { label: "已完成", cls: "bg-green-100 text-green-700" },
    review: { label: "需确认", cls: "bg-amber-100 text-amber-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status] || map.pending;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
