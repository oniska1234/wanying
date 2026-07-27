import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export interface AdminSession {
  userId: string;
  role: string;
}

/**
 * 校验管理员身份。返回 session 或 null（调用方返回 401/403）。
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== "ADMIN") return null;
  return { userId: session.user.id, role: session.user.role };
}

/** 未授权响应 */
export function adminDenied() {
  return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
}

/** 将任意值转为 Prisma 可接受的 JSON 输入（null/undefined -> DbNull） */
function json(v: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (v === null || v === undefined) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/** 写审计日志 */
export async function audit(
  userId: string,
  action: string,
  entity: string,
  entityId?: string,
  before?: unknown,
  after?: unknown
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId: entityId || null,
        before: json(before),
        after: json(after),
      },
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}

export interface ConflictGroup {
  feeType: string;
  category: string;
  shopType: string;
  bxpStatus: string;
  ruleIds: string[];
  message: string;
}

/**
 * 规则冲突检测：同一 (feeType+category+shopType+bxpStatus) 下，
 * 处于 DRAFT/PUBLISHED 且生效区间重叠的规则视为潜在冲突。
 */
export async function detectConflicts(): Promise<ConflictGroup[]> {
  const rules = await prisma.feeRule.findMany({
    where: { status: { in: ["DRAFT", "PUBLISHED"] } },
    select: {
      id: true,
      feeType: true,
      category: true,
      shopType: true,
      bxpStatus: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  const groups = new Map<string, typeof rules>();
  for (const r of rules) {
    const key = `${r.feeType}|${r.category}|${r.shopType}|${r.bxpStatus}`;
    const arr = groups.get(key) || [];
    arr.push(r);
    groups.set(key, arr);
  }

  const conflicts: ConflictGroup[] = [];
  for (const [, arr] of groups) {
    if (arr.length < 2) continue;
    // 两两判断生效区间是否重叠
    const overlapping = new Set<string>();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (rangesOverlap(arr[i].effectiveFrom, arr[i].effectiveTo, arr[j].effectiveFrom, arr[j].effectiveTo)) {
          overlapping.add(arr[i].id);
          overlapping.add(arr[j].id);
        }
      }
    }
    if (overlapping.size > 0) {
      conflicts.push({
        feeType: arr[0].feeType,
        category: arr[0].category,
        shopType: arr[0].shopType,
        bxpStatus: arr[0].bxpStatus,
        ruleIds: [...overlapping],
        message: `同维度存在 ${overlapping.size} 条生效区间重叠的规则，请核对`,
      });
    }
  }
  return conflicts;
}

function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo ? aTo.getTime() : Infinity;
  const bEnd = bTo ? bTo.getTime() : Infinity;
  return aFrom.getTime() <= bEnd && bFrom.getTime() <= aEnd;
}
