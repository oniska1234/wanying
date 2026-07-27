"use client";

import { useState } from "react";
import { Btn, CopyButton, Label, areaCls } from "@/components/ui";

function toWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);
}

const transforms: { key: string; label: string; fn: (s: string) => string }[] = [
  { key: "upper", label: "全大写", fn: (s) => s.toUpperCase() },
  { key: "lower", label: "全小写", fn: (s) => s.toLowerCase() },
  {
    key: "title",
    label: "首字母大写",
    fn: (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()),
  },
  {
    key: "sentence",
    label: "句首大写",
    fn: (s) =>
      s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase()),
  },
  {
    key: "camel",
    label: "小驼峰",
    fn: (s) =>
      toWords(s)
        .map((w, i) =>
          i === 0
            ? w.toLowerCase()
            : w[0].toUpperCase() + w.slice(1).toLowerCase()
        )
        .join(""),
  },
  {
    key: "pascal",
    label: "大驼峰",
    fn: (s) =>
      toWords(s)
        .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(""),
  },
  {
    key: "snake",
    label: "下划线",
    fn: (s) => toWords(s).map((w) => w.toLowerCase()).join("_"),
  },
  {
    key: "kebab",
    label: "中划线",
    fn: (s) => toWords(s).map((w) => w.toLowerCase()).join("-"),
  },
];

export default function CaseConvert() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [active, setActive] = useState("");

  const apply = (t: (typeof transforms)[number]) => {
    setOutput(t.fn(input));
    setActive(t.key);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>输入文本</Label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder="输入要转换的文本，如 hello world 或 userName"
          className={areaCls}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {transforms.map((t) => (
          <Btn
            key={t.key}
            variant={active === t.key ? "primary" : "soft"}
            onClick={() => apply(t)}
          >
            {t.label}
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
            rows={5}
            className={`${areaCls} bg-paper-2`}
          />
        </div>
      )}
    </div>
  );
}
