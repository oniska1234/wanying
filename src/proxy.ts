// ============================================================
// 万应 · Proxy（Next.js 16 网络边界，原 middleware）
// ------------------------------------------------------------
// 职责：
// 1. /quote-compare → /tools/quote-compare 301 归一（canonical）
// 2. 保护需登录路由（选品清单 / 用户设置 / 管理后台）：
//    未登录时重定向到 /auth/login。边缘层仅做轻量「是否有会话
//    凭证」判断（读取 cookie），真正的鉴权（角色等）在服务端
//    通过 auth() 完成，避免在边缘引入 Prisma。
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

/** Auth.js v5 会话 cookie 名（开发 http / 生产 https） */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

function hasSession(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => req.cookies.get(name)?.value);
}

/** 需要登录才能访问的路径前缀 */
const PROTECTED_PREFIXES = ["/my-profit/list", "/my-profit/import", "/my-profit/settings", "/admin"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 报价齐别名归一
  if (pathname === "/quote-compare") {
    const url = request.nextUrl.clone();
    url.pathname = "/tools/quote-compare";
    return NextResponse.redirect(url, 301);
  }

  // 2. 受保护路由：未登录 → 登录页（带回跳地址）
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (isProtected && !hasSession(request)) {
    const login = request.nextUrl.clone();
    login.pathname = "/auth/login";
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/quote-compare", "/my-profit/list/:path*", "/my-profit/import/:path*", "/my-profit/settings/:path*", "/admin/:path*"],
};
