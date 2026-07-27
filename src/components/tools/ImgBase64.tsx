"use client";

import { useRef, useState } from "react";
import { UploadCloud, X } from "lucide-react";
import { Btn, CopyButton, Label, Panel } from "@/components/ui";

interface Info {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function ImgBase64() {
  const [info, setInfo] = useState<Info | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () =>
      setInfo({
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: reader.result as string,
      });
    reader.readAsDataURL(file);
  };

  const base64 = info ? info.dataUrl.split(",")[1] ?? "" : "";

  return (
    <div className="space-y-4">
      {!info ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) readFile(f);
          }}
          className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed py-16 text-center transition-colors ${
            drag
              ? "border-accent bg-accent/5"
              : "border-ink/20 bg-card hover:border-accent/50"
          }`}
        >
          <UploadCloud size={40} className="text-ink/30" />
          <p className="mt-3 font-semibold">点击选择或拖拽图片到此处</p>
          <p className="mt-1 text-sm text-muted">
            支持 PNG / JPG / GIF / WebP / SVG，图片不会上传服务器
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
            }}
          />
        </div>
      ) : (
        <>
          <Panel className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <img
              src={info.dataUrl}
              alt={info.name}
              className="h-28 w-28 shrink-0 rounded-lg border border-ink/10 bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] object-contain p-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{info.name}</p>
              <p className="mt-1 text-sm text-muted">
                {info.type} · {fmtSize(info.size)} · Base64 约{" "}
                {fmtSize(base64.length)}
              </p>
              <div className="mt-3 flex gap-2">
                <Btn variant="soft" onClick={() => inputRef.current?.click()}>
                  重新选择
                </Btn>
                <Btn variant="ghost" onClick={() => setInfo(null)}>
                  <X size={15} /> 移除
                </Btn>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
            />
          </Panel>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Data URL（可直接用于 img src）</Label>
              <CopyButton text={info.dataUrl} label="复制" />
            </div>
            <textarea
              readOnly
              value={info.dataUrl}
              rows={4}
              className="w-full resize-y rounded-lg border border-ink/15 bg-paper-2 p-3.5 font-mono text-xs leading-relaxed scroll-thin"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>纯 Base64（不含前缀）</Label>
              <CopyButton text={base64} label="复制" />
            </div>
            <textarea
              readOnly
              value={base64}
              rows={4}
              className="w-full resize-y rounded-lg border border-ink/15 bg-paper-2 p-3.5 font-mono text-xs leading-relaxed scroll-thin"
            />
          </div>
        </>
      )}
    </div>
  );
}
