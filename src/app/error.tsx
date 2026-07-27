"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

/**
 * 全局错误边界（基础错误监控）。
 * 捕获渲染错误，记录到控制台（生产环境可接入日志服务），
 * 并向用户展示友好的降级界面。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 基础错误日志（生产可上报到监控平台）
    console.error("[GlobalError]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      at: new Date().toISOString(),
    });
  }, [error]);

  return (
    <div className="mx-auto grid max-w-lg place-items-center px-5 py-24 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-100 text-red-500">
        <AlertTriangle size={30} />
      </span>
      <h1 className="mt-6 text-2xl font-bold">页面出了点问题</h1>
      <p className="mt-2 text-sm text-muted">
        抱歉，加载时发生错误。你可以重试，或返回首页。
        {error.digest ? <span className="mt-1 block text-xs">错误编号：{error.digest}</span> : null}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white hover:bg-accent/90"
        >
          <RefreshCw size={15} /> 重试
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-4 py-2.5 text-sm font-semibold hover:bg-ink/5"
        >
          <Home size={15} /> 返回首页
        </Link>
      </div>
    </div>
  );
}
