import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * 注册 POST /api/auth/register
 * body: { email, password, name? }
 */
export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "邮箱和密码为必填项" },
        { status: 400 }
      );
    }

    const emailNorm = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json(
        { error: "密码至少 6 位" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email: emailNorm } });
    if (existing) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: {
        email: emailNorm,
        password: hashed,
        name: name || emailNorm.split("@")[0],
      },
    });

    // 默认创建免费订阅
    await prisma.subscription.create({
      data: { userId: user.id, plan: "FREE", status: "ACTIVE" },
    });

    return NextResponse.json({ ok: true, id: user.id });
  } catch (e) {
    console.error("register error", e);
    return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 });
  }
}
