import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

/**
 * Auth.js v5 配置
 * - 邮箱 + 密码登录（Credentials）
 * - Prisma Adapter（User/Account/Session）
 * - JWT 会话（无需 Session 表查询，适合边缘代理）
 * - 当 NEXTAUTH_URL 为 HTTPS 时自动启用 Secure Cookie
 */
const isHttps = (process.env.NEXTAUTH_URL || "").startsWith("https");

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  // 站点部署在 Nginx 反向代理之后，需信任代理转发的 Host/Proto 头，
  // 否则 Auth.js v5 会抛出 UntrustedHost 错误。
  trustHost: true,
  // HTTPS 环境下设置 Secure Cookie，防止会话被窃听
  useSecureCookies: isHttps,
  cookies: isHttps ? {
    sessionToken: { name: "authjs.session-token", options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" } },
    csrfToken: { name: "authjs.csrf-token", options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" } },
    callbackUrl: { name: "authjs.callback-url", options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" } },
  } : undefined,
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "USER";
      }
      return session;
    },
  },
});
