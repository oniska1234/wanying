import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "CANDIDATE", "SAMPLING", "ABANDONED", "LISTED"];

type Params = { params: Promise<{ id: string }> };

/** 校验归属 */
async function owned(userId: string, id: string) {
  return prisma.product.findFirst({ where: { id, userId } });
}

/** GET /api/my-profit/products/[id] */
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, userId: session.user.id },
    include: {
      skus: {
        include: { calculations: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
  if (!product) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ product });
}

/** PATCH /api/my-profit/products/[id] —— 更新名称/状态/标签/备注 */
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const existing = await owned(session.user.id, id);
  if (!existing) return NextResponse.json({ error: "未找到" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 100);
  if (typeof body.url === "string") data.url = body.url || null;
  if (typeof body.note === "string") data.note = body.note || null;
  if (typeof body.status === "string") {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "状态不支持" }, { status: 400 });
    }
    data.status = body.status;
  }
  if (Array.isArray(body.tags)) {
    data.tags = body.tags.slice(0, 10).map((t) => String(t).slice(0, 20));
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }

  const product = await prisma.product.update({ where: { id }, data });
  return NextResponse.json({ product });
}

/** DELETE /api/my-profit/products/[id] */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const existing = await owned(session.user.id, id);
  if (!existing) return NextResponse.json({ error: "未找到" }, { status: 404 });
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
