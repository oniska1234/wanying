import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { RuleStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * 费率规则 GET /api/my-profit/fee-rules?site=MY
 * 返回已发布且在生效期内的费率规则，供前端计算引擎匹配使用
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const site = (searchParams.get("site") || "MY").toUpperCase();
  const now = new Date();

  const rules = await prisma.feeRule.findMany({
    where: {
      site,
      status: RuleStatus.PUBLISHED,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    orderBy: [{ feeType: "asc" }, { version: "desc" }],
  });

  // 转换为前端 RawFeeRule 格式
  const raw = rules.map((r) => ({
    id: r.id,
    site: r.site,
    feeType: r.feeType,
    category: r.category,
    shopType: r.shopType,
    bxpStatus: r.bxpStatus,
    rate: r.rate === null ? null : Number(r.rate),
    fixedAmount: r.fixedAmount === null ? null : Number(r.fixedAmount),
    perUnit: r.perUnit,
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
    version: r.version,
    source: r.source,
  }));

  return NextResponse.json({ site, count: raw.length, rules: raw });
}
