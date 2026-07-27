// ============================================================
// 万应 · Proxy（Next.js 16 网络边界，原 middleware）
// ------------------------------------------------------------
// 报价齐的规范（canonical）地址为 /tools/quote-compare（与站内
// 所有工具链接 /tools/[slug] 保持一致）。/quote-compare 为其别名，
// 通过 301 永久重定向归一，避免重复内容分散权重。
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/quote-compare") {
    const url = request.nextUrl.clone();
    url.pathname = "/tools/quote-compare";
    return NextResponse.redirect(url, 301);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/quote-compare"],
};
