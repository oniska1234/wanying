"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn, CopyButton, Label, Panel } from "@/components/ui";

export default function Random() {
  const [min, setMin] = useState("1");
  const [max, setMax] = useState("100");
  const [count, setCount] = useState(5);
  const [unique, setUnique] = useState(false);
  const [sort, setSort] = useState(false);
  const [result, setResult] = useState<number[]>([]);
  const [error, setError] = useState("");

  const generate = () => {
    const lo = Math.ceil(Number(min));
    const hi = Math.floor(Number(max));
    if (isNaN(lo) || isNaN(hi)) {
      setError("请输入有效的数字范围");
      return;
    }
    if (lo > hi) {
      setError("最小值不能大于最大值");
      return;
    }
    const range = hi - lo + 1;
    if (unique && count > range) {
      setError(`范围只有 ${range} 个整数，无法不重复生成 ${count} 个`);
      return;
    }
    setError("");
    let arr: number[] = [];
    if (unique) {
      const set = new Set<number>();
      while (set.size < count)
        set.add(lo + Math.floor(Math.random() * range));
      arr = [...set];
    } else {
      for (let i = 0; i < count; i++)
        arr.push(lo + Math.floor(Math.random() * range));
    }
    if (sort) arr.sort((a, b) => a - b);
    setResult(arr);
  };

  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>最小值</Label>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3.5 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <Label>最大值</Label>
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3.5 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div>
          <Label>数量：{count}</Label>
          <input
            type="range"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full accent-[#ff4e1b]"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setUnique((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              unique
                ? "border-accent bg-accent/10 text-accent"
                : "border-ink/15 text-ink/50"
            }`}
          >
            不重复
          </button>
          <button
            onClick={() => setSort((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              sort
                ? "border-accent bg-accent/10 text-accent"
                : "border-ink/15 text-ink/50"
            }`}
          >
            结果排序
          </button>
        </div>

        <Btn onClick={generate}>
          <RefreshCw size={15} /> 生成随机数
        </Btn>
        {error && <p className="text-sm text-accent">{error}</p>}
      </Panel>

      {result.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>结果</Label>
            <CopyButton text={result.join(", ")} label="复制全部" />
          </div>
          <div className="flex flex-wrap gap-2">
            {result.map((n, i) => (
              <span
                key={i}
                className="rounded-lg border border-ink/10 bg-card px-3.5 py-2 font-mono text-sm font-bold"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
