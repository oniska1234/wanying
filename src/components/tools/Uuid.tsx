"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn, CopyButton, Label, Panel } from "@/components/ui";

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function Uuid() {
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [noDash, setNoDash] = useState(false);
  const [list, setList] = useState<string[]>([]);

  const generate = () => {
    const arr: string[] = [];
    for (let i = 0; i < count; i++) {
      let u = uuid();
      if (noDash) u = u.replace(/-/g, "");
      if (upper) u = u.toUpperCase();
      arr.push(u);
    }
    setList(arr);
  };

  const all = list.join("\n");

  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        <div>
          <Label>数量：{count}</Label>
          <input
            type="range"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full accent-[#ff4e1b]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setUpper((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              upper
                ? "border-accent bg-accent/10 text-accent"
                : "border-ink/15 text-ink/50"
            }`}
          >
            大写
          </button>
          <button
            onClick={() => setNoDash((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              noDash
                ? "border-accent bg-accent/10 text-accent"
                : "border-ink/15 text-ink/50"
            }`}
          >
            去掉横线
          </button>
        </div>
        <Btn onClick={generate}>
          <RefreshCw size={15} /> 生成 UUID v4
        </Btn>
      </Panel>

      {list.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <Label>结果（{list.length} 个）</Label>
            <CopyButton text={all} label="复制全部" />
          </div>
          <div className="space-y-2">
            {list.map((u, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-card px-4 py-2.5"
              >
                <code className="min-w-0 flex-1 truncate font-mono text-sm">
                  {u}
                </code>
                <CopyButton text={u} label="复制" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
