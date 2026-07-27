"use client";

import { useState } from "react";
import { Btn, CopyButton, Label, areaCls } from "@/components/ui";

export default function LineTools() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [active, setActive] = useState("");

  const lines = () => input.split(/\n/);

  const ops: {
    key: string;
    label: string;
    fn: () => string;
  }[] = [
    {
      key: "dedupe",
      label: "去重",
      fn: () => [...new Set(lines())].join("\n"),
    },
    {
      key: "sort-asc",
      label: "升序排序",
      fn: () => [...lines()].sort((a, b) => a.localeCompare(b, "zh")).join("\n"),
    },
    {
      key: "sort-desc",
      label: "降序排序",
      fn: () =>
        [...lines()].sort((a, b) => b.localeCompare(a, "zh")).join("\n"),
    },
    {
      key: "trim",
      label: "去行首尾空格",
      fn: () => lines().map((l) => l.trim()).join("\n"),
    },
    {
      key: "no-empty",
      label: "删空行",
      fn: () => lines().filter((l) => l.trim() !== "").join("\n"),
    },
    {
      key: "number",
      label: "加行号",
      fn: () =>
        lines()
          .map((l, i) => `${String(i + 1).padStart(3, " ")}  ${l}`)
          .join("\n"),
    },
    {
      key: "reverse",
      label: "倒序",
      fn: () => [...lines()].reverse().join("\n"),
    },
  ];

  const run = (op: (typeof ops)[number]) => {
    setOutput(op.fn());
    setActive(op.key);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>输入文本（每行一条）</Label>
          <span className="text-xs text-ink/40">
            共 {input === "" ? 0 : lines().length} 行
          </span>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={"苹果\n香蕉\n苹果\n橘子"}
          className={areaCls}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {ops.map((op) => (
          <Btn
            key={op.key}
            variant={active === op.key ? "primary" : "soft"}
            onClick={() => run(op)}
          >
            {op.label}
          </Btn>
        ))}
      </div>

      {output && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>结果</Label>
            <CopyButton text={output} />
          </div>
          <textarea
            readOnly
            value={output}
            rows={8}
            className={`${areaCls} bg-paper-2`}
          />
        </div>
      )}
    </div>
  );
}
