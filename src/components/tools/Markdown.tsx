"use client";

import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Eye, Code2 } from "lucide-react";
import { areaCls } from "@/components/ui";

const SAMPLE = `# 万应 Markdown 预览

在左侧书写，右侧**实时渲染**。支持常用语法：

## 列表
- 免费、无需注册
- 数据不出浏览器
  - 嵌套项也可以

## 代码
行内代码 \`const a = 1\`，代码块：

\`\`\`js
function hello(name) {
  return \`你好, \${name}\`;
}
\`\`\`

## 表格
| 工具 | 分类 |
| --- | --- |
| JSON 格式化 | 编码转换 |
| 二维码生成 | 生成计算 |

> 引用：万事有应，一器即用。

[访问首页](/)
`;

marked.setOptions({ gfm: true, breaks: true });

export default function Markdown() {
  const [src, setSrc] = useState(SAMPLE);
  const [tab, setTab] = useState<"split" | "edit" | "preview">("split");

  const html = useMemo(() => {
    try {
      const raw = marked.parse(src) as string;
      // 净化 HTML，防止 XSS（如 <script>、onerror 等）
      return typeof window !== "undefined"
        ? DOMPurify.sanitize(raw)
        : raw;
    } catch {
      return "<p>渲染出错</p>";
    }
  }, [src]);

  const tabs = [
    { key: "edit", label: "编辑", icon: Code2 },
    { key: "split", label: "分屏", icon: null },
    { key: "preview", label: "预览", icon: Eye },
  ] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-lg border border-ink/10 bg-paper-2 p-1 sm:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.key ? "bg-ink text-paper" : "text-ink/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* editor */}
        <div
          className={
            tab === "preview" ? "hidden lg:block" : ""
          }
        >
          <textarea
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            rows={22}
            spellCheck={false}
            className={`${areaCls} h-full min-h-[28rem]`}
          />
        </div>

        {/* preview */}
        <div
          className={`rounded-xl border border-ink/10 bg-card p-6 ${
            tab === "edit" ? "hidden lg:block" : ""
          }`}
        >
          <div
            className="md-body max-h-[28rem] overflow-auto scroll-thin"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
