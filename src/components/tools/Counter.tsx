"use client";

import { useMemo, useState } from "react";
import { Label, areaCls } from "@/components/ui";

const SAMPLE = `万应是一个在线工具箱。\nIt provides JSON, Base64, QR code and more. 打开即用，免费无需注册。`;

export default function Counter() {
  const [text, setText] = useState("");

  const stats = useMemo(() => {
    const chars = text.length;
    const noSpace = text.replace(/\s/g, "").length;
    const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const words = (
      text.trim().match(/[A-Za-z0-9]+[\u4e00-\u9fa5]*/g) || []
    ).length;
    const lines = text === "" ? 0 : text.split(/\n/).length;
    const paragraphs =
      text.trim() === ""
        ? 0
        : text.split(/\n\s*\n/).filter((p) => p.trim()).length;
    // reading speed: ~300 中文字/分 + 200 英文词/分
    const minutes = cjk / 300 + words / 200;
    const readTime =
      minutes < 1 / 60 ? "≈ 0 秒" : `≈ ${Math.max(1, Math.round(minutes * 60))} 秒`;
    return { chars, noSpace, cjk, words, lines, paragraphs, readTime };
  }, [text]);

  const cards = [
    { label: "总字符", value: stats.chars, accent: true },
    { label: "不含空格", value: stats.noSpace },
    { label: "中文字数", value: stats.cjk },
    { label: "词数", value: stats.words },
    { label: "行数", value: stats.lines },
    { label: "段落数", value: stats.paragraphs },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border p-3 text-center ${
              c.accent
                ? "border-accent/30 bg-accent/5"
                : "border-ink/10 bg-card"
            }`}
          >
            <div
              className={`font-display text-2xl ${
                c.accent ? "text-accent" : "text-ink"
              }`}
            >
              {c.value}
            </div>
            <div className="mt-1 text-xs text-muted">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-paper-2 px-4 py-2.5 text-sm">
        <span className="text-muted">预计阅读时长</span>
        <span className="font-bold text-pine">{stats.readTime}</span>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>输入或粘贴文本</Label>
          <div className="flex gap-3 text-xs">
            <button
              onClick={() => setText(SAMPLE)}
              className="text-accent hover:underline"
            >
              填入示例
            </button>
            <button
              onClick={() => setText("")}
              className="text-ink/50 hover:underline"
            >
              清空
            </button>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="开始输入，统计结果实时更新…"
          className={areaCls}
        />
      </div>
    </div>
  );
}
