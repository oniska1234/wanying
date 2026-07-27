import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/my-profit/products/batch-delete  body: { ids: string[] } */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "未选择商品" }, { status: 400 });
  }
  const ids = body.ids.map((x) => String(x)).slice(0, 200);

  const res = await prisma.product.deleteMany({
    where: { id: { in: ids }, userId: session.user.id },
  });
  return NextResponse.json({ ok: true, deleted: res.count });
}
