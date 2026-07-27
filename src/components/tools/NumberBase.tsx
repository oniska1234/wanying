"use client";

import { useState } from "react";
import { CopyButton, Panel } from "@/components/ui";

type Base = 2 | 8 | 10 | 16;

const BASES: { base: Base; name: string; prefix: string }[] = [
  { base: 2, name: "二进制", prefix: "0b" },
  { base: 8, name: "八进制", prefix: "0o" },
  { base: 10, name: "十进制", prefix: "" },
  { base: 16, name: "十六进制", prefix: "0x" },
];

export default function NumberBase() {
  const [value, setValue] = useState("255");
  const [activeBase, setActiveBase] = useState<Base>(10);
  const [error, setError] = useState("");

  const clean = value.trim().replace(/^(0b|0o|0x)/i, "");
  const num = parseInt(clean, activeBase);
  const valid = clean !== "" && !isNaN(num);

  const onChange = (v: string, base: Base) => {
    setValue(v);
    setActiveBase(base);
    const c = v.trim().replace(/^(0b|0o|0x)/i, "");
    if (c === "") {
      setError("");
      return;
    }
    const n = parseInt(c, base);
    setError(isNaN(n) ? `不是合法的${base}进制数` : "");
  };

  return (
    <div className="space-y-3">
      {BASES.map((b) => {
        const display = valid ? num.toString(b.base) : "";
        const isActive = activeBase === b.base;
        return (
          <Panel
            key={b.base}
            className={isActive ? "ring-2 ring-accent/30" : ""}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold">
                {b.name}
                <span className="ml-2 text-xs font-normal text-ink/40">
                  {b.base} 进制
                </span>
              </span>
              {valid && <CopyButton text={b.prefix + display} label="复制" />}
            </div>
            <input
              value={isActive ? value : display}
              onChange={(e) => onChange(e.target.value, b.base)}
              onFocus={() => setActiveBase(b.base)}
              spellCheck={false}
              placeholder={`${b.name}数值`}
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3.5 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </Panel>
        );
      })}

      {error && <p className="text-sm text-accent">{error}</p>}

      {valid && (
        <p className="px-1 text-xs text-muted">
          提示：在任意输入框修改数值，其余进制会实时同步换算。
        </p>
      )}
    </div>
  );
}
