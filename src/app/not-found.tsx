import Link from "next/link";
import { Home } from "lucide-react";

// ============================================================
// 万应 · 404 页面
// ------------------------------------------------------------
// 提供友好的未找到提示与回首页入口，降低跳出率，
// 也利于搜索引擎识别死链（配合 sitemap 保持收录健康）。
// ============================================================

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-5xl place-items-center px-5 py-24 text-center">
      <p className="font-display text-7xl text-ink/15">404</p>
      <h1 className="mt-4 text-xl font-bold">页面不存在</h1>
      <p className="mt-2 text-sm text-muted">
        你访问的页面可能已被移动或不再可用，去首页看看其他工具吧。
      </p>
      <Link
        href="/"
        className="mt-6 flex items-center gap-1.5 rounded-lg bg-[#3b5bdb] px-4 py-2 text-sm font-bold text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)] transition-all hover:-translate-y-0.5"
      >
        <Home size={15} /> 返回首页
      </Link>
    </div>
  );
}
