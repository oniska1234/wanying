import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const rawSize = parseInt(searchParams.get("page_size") || "20", 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) ? Math.min(50, Math.max(1, rawSize)) : 20;

  const [items, total] = await Promise.all([
    prisma.imageTranslateHighTask.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.imageTranslateHighTask.count({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({
    items: items.map((t) => ({
      id: t.id,
      status: t.status,
      total_count: t.totalCount,
      done_count: t.doneCount,
      failed_count: t.failedCount,
      created_at: t.createdAt.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  });
}
