"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn, CopyButton, Label, Panel } from "@/components/ui";

const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  number: "0123456789",
  symbol: "!@#$%^&*()-_=+[]{};:,.<>?",
};
const AMBIGUOUS = /[il1Lo0O]/g;

function genPassword(
  len: number,
  opts: Record<keyof typeof SETS, boolean>,
  noAmbiguous: boolean
): string {
  let pool = "";
  (Object.keys(SETS) as (keyof typeof SETS)[]).forEach((k) => {
    if (opts[k]) pool += SETS[k];
  });
  if (!pool) return "";
  if (noAmbiguous) pool = pool.replace(AMBIGUOUS, "");
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[arr[i] % pool.length];
  return out;
}

function strength(pw: string): { label: string; pct: number; color: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map = [
    { label: "很弱", pct: 20, color: "#dc2626" },
    { label: "较弱", pct: 40, color: "#e07b0c" },
    { label: "中等", pct: 60, color: "#f0b429" },
    { label: "强", pct: 80, color: "#0c8f5f" },
    { label: "很强", pct: 100, color: "#1f6f54" },
  ];
  return map[Math.min(score, 4)];
}

export default function Password() {
  const [len, setLen] = useState(16);
  const [count, setCount] = useState(5);
  const [opts, setOpts] = useState({
    lower: true,
    upper: true,
    number: true,
    symbol: true,
  });
  const [noAmbiguous, setNoAmbiguous] = useState(false);
  const [list, setList] = useState<string[]>([]);

  const generate = useCallback(() => {
    const arr: string[] = [];
    for (let i = 0; i < count; i++)
      arr.push(genPassword(len, opts, noAmbiguous));
    setList(arr);
  }, [len, count, opts, noAmbiguous]);

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggles: { key: keyof typeof SETS; label: string }[] = [
    { key: "lower", label: "小写 a-z" },
    { key: "upper", label: "大写 A-Z" },
    { key: "number", label: "数字 0-9" },
    { key: "symbol", label: "符号 !@#" },
  ];

  const s = list[0] ? strength(list[0]) : null;

  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>长度：{len}</Label>
            <input
              type="range"
              min={6}
              max={64}
              value={len}
              onChange={(e) => setLen(Number(e.target.value))}
              className="w-full accent-[#ff4e1b]"
            />
          </div>
          <div>
            <Label>数量：{count}</Label>
            <input
              type="range"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-[#ff4e1b]"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {toggles.map((t) => (
            <button
              key={t.key}
              onClick={() => setOpts((o) => ({ ...o, [t.key]: !o[t.key] }))}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                opts[t.key]
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-ink/15 text-ink/50"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => setNoAmbiguous((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              noAmbiguous
                ? "border-pine bg-pine/10 text-pine"
                : "border-ink/15 text-ink/50"
            }`}
          >
            排除易混字符
          </button>
        </div>

        <Btn onClick={generate}>
          <RefreshCw size={15} /> 重新生成
        </Btn>
      </Panel>

      {s && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">强度</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${s.pct}%`, background: s.color }}
            />
          </div>
          <span className="text-sm font-bold" style={{ color: s.color }}>
            {s.label}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {list.map((pw, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-card px-4 py-3"
          >
            <code className="min-w-0 flex-1 truncate font-mono text-sm">
              {pw}
            </code>
            <CopyButton text={pw} label="复制" />
          </div>
        ))}
      </div>
    </div>
  );
}
