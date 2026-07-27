"use client";

import { useState } from "react";
import { Check, XCircle, Wand2, Minimize2 } from "lucide-react";
import { Btn, CopyButton, Label, Panel, areaCls } from "@/components/ui";

const SAMPLE = `{"name":"万应","type":"工具箱","free":true,"tags":["JSON","Base64","二维码"]}`;

export default function JsonFormat() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [indent, setIndent] = useState(2);
  const [error, setError] = useState("");

  const run = (space: number) => {
    const src = input.trim();
    if (!src) {
      setError("");
      setOutput("");
      return;
    }
    try {
      const obj = JSON.parse(src);
      setOutput(JSON.stringify(obj, null, space === 0 ? "\t" : space));
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setOutput("");
    }
  };

  const format = () => run(indent);
  const compress = () => {
    const src = input.trim();
    if (!src) return;
    try {
      setOutput(JSON.stringify(JSON.parse(src)));
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setOutput("");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>输入 JSON</Label>
          <button
            onClick={() => setInput(SAMPLE)}
            className="text-xs text-accent hover:underline"
          >
            填入示例
          </button>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={9}
          spellCheck={false}
          placeholder='粘贴 JSON，例如 {"name":"万应"}'
          className={areaCls}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={format}>
          <Wand2 size={15} /> 格式化
        </Btn>
        <Btn onClick={compress} variant="soft">
          <Minimize2 size={15} /> 压缩
        </Btn>
        <div className="ml-1 flex items-center gap-1 rounded-lg border border-ink/10 bg-paper-2 p-1">
          {[2, 4].map((n) => (
            <button
              key={n}
              onClick={() => setIndent(n)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                indent === n ? "bg-ink text-paper" : "text-ink/60"
              }`}
            >
              {n} 空格
            </button>
          ))}
          <button
            onClick={() => setIndent(0)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              indent === 0 ? "bg-ink text-paper" : "text-ink/60"
            }`}
          >
            Tab
          </button>
        </div>
        {output && <CopyButton text={output} className="ml-auto" />}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-accent">
          <XCircle size={17} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">JSON 解析失败</p>
            <p className="mt-0.5 font-mono text-xs">{error}</p>
          </div>
        </div>
      )}

      {output && (
        <Panel className="bg-ink">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-pine">
            <Check size={14} /> 校验通过 · 格式化结果
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-paper scroll-thin">
            {output}
          </pre>
        </Panel>
      )}
    </div>
  );
}
