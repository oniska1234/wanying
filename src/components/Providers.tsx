"use client";

import { SessionProvider } from "next-auth/react";

/**
 * 客户端会话提供者。
 * 在 layout 中包裹整个应用，使所有组件可通过 useSession() 读取登录态。
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
