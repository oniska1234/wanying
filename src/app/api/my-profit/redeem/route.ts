import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlan } from "@/lib/my-profit/quota";

export const dynamic = "force-dynamic";

/** 从环境变量读取有效兑换码（逗号分隔） */
function validCodes(): Set<string> {
  const raw = process.env.REDEEM_CODES || "";
  return new Set(
    raw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
  );
}

const PRO_DAYS = 365;

/**
 * POST /api/my-profit/redeem  body: { code }
 * 使用兑换码开通 Pro（MVP 阶段不接支付）。
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const code = String(body.code || "").trim();
  if (!code) return NextResponse.json({ error: "请输入兑换码" }, { status: 400 });

  if (!validCodes().has(code)) {
    return NextResponse.json({ error: "兑换码无效" }, { status: 400 });
  }

  // 防止同一兑换码被重复使用
  const used = await prisma.subscription.findFirst({ where: { redeemCode: code } });
  if (used) {
    return NextResponse.json({ error: "该兑换码已被使用" }, { status: 409 });
  }

  const expiresAt = new Date(Date.now() + PRO_DAYS * 24 * 60 * 60 * 1000);

  // 优先在现有免费订阅上升级，否则新建
  const existing = await prisma.subscription.findFirst({
    where: { userId: session.user.id, plan: "FREE" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: { plan: "PRO", status: "ACTIVE", redeemCode: code, startsAt: new Date(), expiresAt },
    });
  } else {
    await prisma.subscription.create({
      data: {
        userId: session.user.id,
        plan: "PRO",
        status: "ACTIVE",
        redeemCode: code,
        startsAt: new Date(),
        expiresAt,
      },
    });
  }

  return NextResponse.json({ ok: true, plan: "PRO", expiresAt });
}

/** GET /api/my-profit/redeem —— 查询当前订阅状态 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const plan = await getPlan(session.user.id);
  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { plan: true, expiresAt: true, startsAt: true },
  });
  return NextResponse.json({ plan, subscription: sub });
}
