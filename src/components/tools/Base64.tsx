"use client";

import { useState } from "react";
import { ArrowDownCircle, XCircle } from "lucide-react";
import { Btn, CopyButton, Label, areaCls } from "@/components/ui";

// UTF-8 safe base64
function toB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromB64(b64: string): string {
  const bin = atob(b64.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export default function Base64() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const encode = () => {
    try {
      setOutput(toB64(input));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const decode = () => {
    try {
      setOutput(fromB64(input));
      setError("");
    } catch {
      setError("不是合法的 Base64 字符串");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>输入</Label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder="输入要编码的文本，或要解码的 Base64"
          className={areaCls}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={encode}>编码 → Base64</Btn>
        <Btn onClick={decode} variant="soft">
          Base64 → 文本
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
            rows={6}
            className={`${areaCls} bg-paper-2`}
          />
        </div>
      )}
    </div>
  );
}
