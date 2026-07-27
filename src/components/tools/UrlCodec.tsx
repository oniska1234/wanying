"use client";

import { useState } from "react";
import { ArrowDownCircle, XCircle } from "lucide-react";
import { Btn, CopyButton, Label, areaCls } from "@/components/ui";

export default function UrlCodec() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [component, setComponent] = useState(true);

  const encode = () => {
    try {
      setOutput(
        component ? encodeURIComponent(input) : encodeURI(input)
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const decode = () => {
    try {
      setOutput(
        component ? decodeURIComponent(input) : decodeURI(input)
      );
      setError("");
    } catch {
      setError("解码失败：包含非法的百分号序列");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-lg border border-ink/10 bg-paper-2 p-1 text-sm">
        <button
          onClick={() => setComponent(true)}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            component ? "bg-ink text-paper" : "text-ink/60"
          }`}
        >
          组件编码
        </button>
        <button
          onClick={() => setComponent(false)}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            !component ? "bg-ink text-paper" : "text-ink/60"
          }`}
        >
          整段 URL
        </button>
        <span className="ml-auto pr-2 text-xs text-ink/40">
          {component ? "encodeURIComponent" : "encodeURI"}
        </span>
      </div>

      <div>
        <Label>输入</Label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder="https://example.com/?q=万应&a=1 或 %E4%B8%87%E5%BA%94"
          className={areaCls}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={encode}>编码</Btn>
        <Btn onClick={decode} variant="soft">
          解码
        </Btn>
        {output && <CopyButton text={output} className="ml-auto" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-accent">
          <XCircle size={16} /> {error}
        </div>
      )}

      {output && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink/50">
            <ArrowDownCircle size={14} /> 结果
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
