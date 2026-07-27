import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CURRENCIES = ["CNY", "MYR"];
const SHOP_TYPES = ["MARKETPLACE", "MALL"];
const LOCALES = ["zh"];

/** GET /api/my-profit/settings —— 读取当前用户偏好 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      defaultCurrency: true,
      defaultShopType: true,
      locale: true,
    },
  });
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  return NextResponse.json({ settings: user });
}

/** PATCH /api/my-profit/settings —— 更新用户偏好 */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const data: Record<string, string> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim().slice(0, 40);
  }
  if (typeof body.defaultCurrency === "string") {
    if (!CURRENCIES.includes(body.defaultCurrency)) {
      return NextResponse.json({ error: "币种不支持" }, { status: 400 });
    }
    data.defaultCurrency = body.defaultCurrency;
  }
  if (typeof body.defaultShopType === "string") {
    if (!SHOP_TYPES.includes(body.defaultShopType)) {
      return NextResponse.json({ error: "店铺类型不支持" }, { status: 400 });
    }
    data.defaultShopType = body.defaultShopType;
  }
  if (typeof body.locale === "string") {
    if (!LOCALES.includes(body.locale)) {
      return NextResponse.json({ error: "语言不支持" }, { status: 400 });
    }
    data.locale = body.locale;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: {
      name: true,
      email: true,
      defaultCurrency: true,
      defaultShopType: true,
      locale: true,
    },
  });
  return NextResponse.json({ settings: user });
}
