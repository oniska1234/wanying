import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, adminDenied, audit } from "@/lib/my-profit/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/my-profit/admin/fee-rules/[id]
 * body 支持两类操作：
 * 1. 字段更新：rate/fixedAmount/effectiveFrom/effectiveTo/category/source/note/perUnit...
 * 2. 状态动作：{ action: "publish" | "archive" }
 *    - publish：发布规则；若同维度已有 PUBLISHED 规则，则将其归档（回滚/替换语义）
 *    - archive：归档（回滚）当前规则
 */
export async function PATCH(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return adminDenied();
  const { id } = await params;

  const before = await prisma.feeRule.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "规则不存在" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  // 状态动作
  const action = body.action as string | undefined;
  if (action === "publish") {
    // 将同维度已发布规则归档（保留历史，可回滚）
    await prisma.feeRule.updateMany({
      where: {
        id: { not: id },
        status: "PUBLISHED",
        feeType: before.feeType,
        category: before.category,
        shopType: before.shopType,
        bxpStatus: before.bxpStatus,
      },
      data: { status: "ARCHIVED" },
    });
    const rule = await prisma.feeRule.update({
      where: { id },
      data: { status: "PUBLISHED", version: { increment: 1 } },
    });
    await audit(admin.userId, "PUBLISH", "FeeRule", id, { status: before.status }, { status: "PUBLISHED", version: rule.version });
    return NextResponse.json({ ok: true, rule });
  }
  if (action === "archive") {
    const rule = await prisma.feeRule.update({ where: { id }, data: { status: "ARCHIVED" } });
    await audit(admin.userId, "ARCHIVE", "FeeRule", id, { status: before.status }, { status: "ARCHIVED" });
    return NextResponse.json({ ok: true, rule });
  }

  // 字段更新（仅 DRAFT 可改核心字段；已发布规则改字段会重置为 DRAFT 待重新发布）
  const data: Record<string, unknown> = {};
  if (body.rate !== undefined) data.rate = body.rate === null || body.rate === "" ? null : Number(body.rate);
  if (body.fixedAmount !== undefined)
    data.fixedAmount = body.fixedAmount === null || body.fixedAmount === "" ? null : Number(body.fixedAmount);
  if (body.category !== undefined) data.category = String(body.category);
  if (body.perUnit !== undefined) data.perUnit = String(body.perUnit);
  if (body.source !== undefined) data.source = body.source ? String(body.source) : null;
  if (body.note !== undefined) data.note = body.note ? String(body.note) : null;
  if (body.effectiveFrom !== undefined) data.effectiveFrom = new Date(String(body.effectiveFrom));
  if (body.effectiveTo !== undefined)
    data.effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  // 修改已发布规则 → 回退为草稿，避免线上费率被静默修改
  if (before.status === "PUBLISHED") data.status = "DRAFT";

  const rule = await prisma.feeRule.update({ where: { id }, data });
  await audit(admin.userId, "UPDATE", "FeeRule", id, before, rule);
  return NextResponse.json({ ok: true, rule });
}

/** DELETE /api/my-profit/admin/fee-rules/[id] */
export async function DELETE(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return adminDenied();
  const { id } = await params;
  const before = await prisma.feeRule.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "规则不存在" }, { status: 404 });
  await prisma.feeRule.delete({ where: { id } });
  await audit(admin.userId, "DELETE", "FeeRule", id, before, null);
  return NextResponse.json({ ok: true });
}
