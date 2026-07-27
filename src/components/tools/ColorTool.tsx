"use client";

import { useState } from "react";
import { CopyButton, Label, Panel } from "@/components/ui";

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => n.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const PRESETS = [
  "#ff4e1b",
  "#f0b429",
  "#1f6f54",
  "#2457e6",
  "#d23f8e",
  "#15181e",
];

export default function ColorTool() {
  const [hex, setHex] = useState("#ff4e1b");
  const [error, setError] = useState("");

  const rgb = hexToRgb(hex);

  const onInput = (v: string) => {
    setHex(v);
    setError(hexToRgb(v) ? "" : "无法识别的颜色值");
  };

  const rows = rgb
    ? [
        { label: "HEX", value: rgbToHex(...rgb).toUpperCase() },
        { label: "RGB", value: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` },
        {
          label: "HSL",
          value: `hsl(${rgbToHsl(...rgb).join(", ")})`,
        },
        {
          label: "CSS",
          value: `color: ${rgbToHex(...rgb)};`,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <label
            className="relative h-24 w-24 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-ink/15"
            style={{ background: rgb ? rgbToHex(...rgb) : "#eee" }}
          >
            <input
              type="color"
              value={rgb ? rgbToHex(...rgb) : "#ff4e1b"}
              onChange={(e) => onInput(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="absolute bottom-1 right-1.5 text-[10px] font-bold text-white/80 mix-blend-difference">
              取色
            </span>
          </label>

          <div className="flex-1">
            <Label>颜色值</Label>
            <input
              value={hex}
              onChange={(e) => onInput(e.target.value)}
              placeholder="#ff4e1b 或 ff4e1b"
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3.5 py-2.5 font-mono text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {error && <p className="mt-2 text-sm text-accent">{error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => onInput(p)}
                  className="h-7 w-7 rounded-md border border-ink/15 transition-transform hover:scale-110"
                  style={{ background: p }}
                  title={p}
                />
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {rgb && (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-card p-4"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider text-ink/40">
                  {r.label}
                </div>
                <div className="mt-1 truncate font-mono text-sm">{r.value}</div>
              </div>
              <CopyButton text={r.value} label="复制" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
