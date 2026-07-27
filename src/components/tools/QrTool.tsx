"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, QrCode as QrIcon } from "lucide-react";
import { Btn, Label, Panel } from "@/components/ui";

const LEVELS = ["L", "M", "Q", "H"] as const;

export default function QrTool() {
  const [text, setText] = useState("https://wanying.tools");
  const [size, setSize] = useState(320);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("M");
  const [fg, setFg] = useState("#15181e");
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!text.trim()) {
      setDataUrl("");
      return;
    }
    QRCode.toDataURL(text, {
      width: size,
      margin: 2,
      errorCorrectionLevel: level,
      color: { dark: fg, light: "#ffffff" },
    })
      .then((url) => {
        setDataUrl(url);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [text, size, level, fg]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qrcode-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* controls */}
      <div className="space-y-4">
        <div>
          <Label>内容（网址或文本）</Label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="输入网址或任意文本"
            className="w-full resize-y rounded-lg border border-ink/15 bg-paper/60 p-3.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>尺寸：{size}px</Label>
            <input
              type="range"
              min={160}
              max={640}
              step={20}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full accent-[#ff4e1b]"
            />
          </div>
          <div>
            <Label>容错级别</Label>
            <div className="flex gap-1 rounded-lg border border-ink/10 bg-paper-2 p-1">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors ${
                    level === l ? "bg-ink text-paper" : "text-ink/60"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <Label>前景色</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={fg}
              onChange={(e) => setFg(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-ink/15"
            />
            <span className="font-mono text-sm text-muted">{fg}</span>
          </div>
        </div>

        {error && <p className="text-sm text-accent">{error}</p>}
      </div>

      {/* preview */}
      <Panel className="flex flex-col items-center justify-center gap-4">
        {dataUrl ? (
          <>
            <img
              src={dataUrl}
              alt="二维码预览"
              className="h-56 w-56 rounded-lg border border-ink/10 bg-white object-contain p-2"
            />
            <Btn onClick={download} className="w-full">
              <Download size={15} /> 下载 PNG
            </Btn>
          </>
        ) : (
          <div className="grid h-56 w-56 place-items-center rounded-lg border border-dashed border-ink/20 text-ink/30">
            <QrIcon size={48} />
          </div>
        )}
      </Panel>
    </div>
  );
}
