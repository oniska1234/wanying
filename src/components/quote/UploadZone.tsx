"use client";

import { useRef, useState } from "react";
import { UploadCloud, X, FileText, AlertCircle, ShieldAlert } from "lucide-react";
import { Btn } from "@/components/ui";
import type { UploadFile } from "@/lib/quote-types";

const ACCEPT = ".pdf,.xlsx,.xls,.jpg,.jpeg,.png";
const MAX_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;
const MIN_FILES = 2;

/** 可选的解析方式（与后端 /api/extract 的 provider 字段对应） */
const PROVIDERS = [
  {
    id: "rule",
    label: "本地规则解析",
    hint: "免费 · 无需密钥 · 即时出结果",
  },
  {
    id: "bailian",
    label: "百炼 AI 智能抽取",
    hint: "需服务端配置 DASHSCOPE_API_KEY · 产生调用费用 · 更精准",
  },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

function detectType(name: string): UploadFile["type"] | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xls") return ext as "xlsx" | "xls";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  return null;
}

function fmtSize(b: number): string {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

interface Props {
  onComplete: (files: UploadFile[], providerId: ProviderId) => void;
}

export default function UploadZone({ onComplete }: Props) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [drag, setDrag] = useState(false);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const [provider, setProvider] = useState<ProviderId>("rule");
  // P1-06：选择百炼 AI（付费 + 上传）前必须明确同意
  const [aiConsent, setAiConsent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const newFiles: UploadFile[] = [];
    const newRejected: { name: string; reason: string }[] = [];
    const existingKeys = new Set(files.map((f) => `${f.name}|${f.size}`));
    let room = MAX_FILES - files.length;

    for (const f of incoming) {
      const key = `${f.name}|${f.size}`;
      if (existingKeys.has(key)) {
        newRejected.push({ name: f.name, reason: "与已选文件重复（名称 + 大小相同）" });
        continue;
      }
      const type = detectType(f.name);
      if (!type) {
        newRejected.push({ name: f.name, reason: "不支持的文件格式" });
        continue;
      }
      if (f.size > MAX_SIZE) {
        newRejected.push({ name: f.name, reason: "文件超过 20MB 限制" });
        continue;
      }
      if (room <= 0) {
        newRejected.push({ name: f.name, reason: `超出上限（最多 ${MAX_FILES} 份）` });
        continue;
      }
      newFiles.push({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
        type,
        status: "valid",
      });
      existingKeys.add(key);
      room--;
    }

    if (newFiles.length > 0) setFiles((prev) => [...prev, ...newFiles]);
    setRejected(newRejected);
  };

  const remove = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const validFiles = files.filter((f) => f.status === "valid");
  const filesReady = validFiles.length >= MIN_FILES;
  // 百炼 AI 需额外满足「明确同意」才可开始（P1-06 / 验收阈值 12）
  const consentOk = provider !== "bailian" || aiConsent;
  const canProceed = filesReady && consentOk;

  const handleStart = () => {
    if (canProceed) onComplete(validFiles, provider);
  };

  const activeProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  return (
    <div className="space-y-5">
      {/* drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed py-14 text-center transition-colors ${
          drag ? "border-[#3b5bdb] bg-[#3b5bdb]/5" : "border-ink/20 bg-card hover:border-[#3b5bdb]/50"
        }`}
      >
        <UploadCloud size={40} className="text-ink/30" />
        <p className="mt-3 font-semibold">拖入报价文件，或点击选择</p>
        <p className="mt-1 text-sm text-muted">
          支持 PDF / Excel / JPG / PNG，单文件 ≤ 20MB，需 2～5 份
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* file list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-ink/10 bg-card px-4 py-3"
            >
              <FileText size={18} className="text-[#3b5bdb]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-xs text-muted">
                  {fmtSize(f.size)} · {f.type.toUpperCase()}
                </p>
              </div>
              <button onClick={() => remove(f.id)} className="text-ink/30 hover:text-accent">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* rejected files (明示，不静默丢弃) */}
      {rejected.length > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-accent">
              <AlertCircle size={14} /> 已拒绝 {rejected.length} 份文件
            </span>
            <button
              onClick={() => setRejected([])}
              className="text-xs text-ink/40 hover:text-accent"
            >
              关闭
            </button>
          </div>
          <ul className="space-y-1">
            {rejected.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-muted">
                <span className="truncate font-medium text-ink/70">{r.name}</span>
                <span className="shrink-0 text-accent">{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 解析方式 */}
      <div className="rounded-lg border border-ink/10 bg-card p-3">
        <p className="mb-2 text-xs font-bold text-ink/60">解析方式</p>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => {
            const active = p.id === provider;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-[#3b5bdb] bg-[#3b5bdb]/5 ring-1 ring-[#3b5bdb]/30"
                    : "border-ink/10 hover:border-[#3b5bdb]/40"
                }`}
              >
                <span
                  className={`block text-sm font-semibold ${
                    active ? "text-[#3b5bdb]" : "text-ink/80"
                  }`}
                >
                  {p.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 数据流 / 隐私 / 费用说明（按解析方式分别说明，P1-06） */}
      {provider === "bailian" ? (
        <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gold">
            <ShieldAlert size={14} /> 百炼 AI 模式 · 数据上传、费用与隐私说明
          </p>
          <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
            <li>
              · <span className="font-semibold text-ink/70">会上传什么</span>
              ：所选报价文件的文本与图片内容（用于结构化抽取）。
            </li>
            <li>
              · <span className="font-semibold text-ink/70">传到哪里</span>
              ：经本站服务端转发至阿里云百炼（DashScope）qwen-long 文档理解服务。
            </li>
            <li>
              · <span className="font-semibold text-ink/70">保存多久 / 如何删除</span>
              ：临时文件在调用完成后即请求删除，不做长期留存。
            </li>
            <li>
              · <span className="font-semibold text-ink/70">是否用于训练</span>
              ：不用于模型训练。
            </li>
            <li>
              · <span className="font-semibold text-ink/70">费用</span>
              ：按百炼模型调用量计费，由服务端配置的 DASHSCOPE_API_KEY 承担。
            </li>
          </ul>
          <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={aiConsent}
              onChange={(e) => setAiConsent(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#3b5bdb]"
            />
            <span className="text-ink/70">
              我已阅读并同意上述数据上传、费用与隐私说明，确认开始付费 AI 处理。
            </span>
          </label>
        </div>
      ) : (
        <div className="rounded-lg border border-pine/25 bg-pine/5 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <span className="font-semibold text-pine">本地规则解析</span>
          ：文件内容与所有计算均在您的浏览器本地完成，不上传任何服务器、不产生费用。
        </div>
      )}

      {/* action */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">
          已选 {validFiles.length} 份有效文件（需 {MIN_FILES}～{MAX_FILES} 份）
        </span>
        <Btn onClick={handleStart} disabled={!canProceed}>
          开始处理（{activeProvider.label}）→
        </Btn>
      </div>
    </div>
  );
}
