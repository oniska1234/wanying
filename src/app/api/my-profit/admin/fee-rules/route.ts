import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, adminDenied, audit, detectConflicts } from "@/lib/my-profit/admin";

export const dynamic = "force-dynamic";

const FEE_TYPES = ["COMMISSION", "TRANSACTION", "PLATFORM_SUPPORT"];
const SHOP_TYPES = ["MARKETPLACE", "MALL"];
const BXP = ["BXP", "NON_BXP", "UNCERTAIN"];
const UNITS = ["ORDER", "ITEM", "REVENUE"];

function ser(r: {
  id: string;
  site: string;
  feeType: string;
  category: string;
  shopType: string;
  bxpStatus: string;
  rate: unknown;
  fixedAmount: unknown;
  perUnit: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  version: number;
  status: string;
  source: string | null;
  note: string | null;
  updatedAt: Date;
}) {
  return {
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
    status: r.status,
    source: r.source,
    note: r.note,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** GET /api/my-profit/admin/fee-rules?status=&feeType=&q= */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return adminDenied();

  const { searchParams } = new URL(req.url);
  const where: Record<string, unknown> = {};
  const status = searchParams.get("status");
  if (status && status !== "ALL") where.status = status;
  const feeType = searchParams.get("feeType");
  if (feeType && feeType !== "ALL") where.feeType = feeType;
  const q = searchParams.get("q")?.trim();
  if (q) where.category = { contains: q, mode: "insensitive" };

  const [rules, conflicts] = await Promise.all([
    prisma.feeRule.findMany({
      where,
      orderBy: [{ feeType: "asc" }, { category: "asc" }, { effectiveFrom: "desc" }],
    }),
    detectConflicts(),
  ]);

  const conflictIds = new Set(conflicts.flatMap((c) => c.ruleIds));
  return NextResponse.json({
    count: rules.length,
    rules: rules.map((r) => ({ ...ser(r), hasConflict: conflictIds.has(r.id) })),
    conflicts,
  });
}

/** POST /api/my-profit/admin/fee-rules —— 新建规则（默认 DRAFT） */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return adminDenied();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const feeType = String(body.feeType || "");
  if (!FEE_TYPES.includes(feeType)) return NextResponse.json({ error: "费用类型无效" }, { status: 400 });
  const shopType = String(body.shopType || "MARKETPLACE");
  if (!SHOP_TYPES.includes(shopType)) return NextResponse.json({ error: "店铺类型无效" }, { status: 400 });
  const bxpStatus = String(body.bxpStatus || "NON_BXP");
  if (!BXP.includes(bxpStatus)) return NextResponse.json({ error: "BXP 状态无效" }, { status: 400 });
  const perUnit = String(body.perUnit || "ORDER");
  if (!UNITS.includes(perUnit)) return NextResponse.json({ error: "计费单位无效" }, { status: 400 });

  const rate = body.rate === null || body.rate === "" ? null : Number(body.rate);
  const fixedAmount = body.fixedAmount === null || body.fixedAmount === "" ? null : Number(body.fixedAmount);
  if (rate === null && fixedAmount === null) {
    return NextResponse.json({ error: "比例费率与固定金额至少填一项" }, { status: 400 });
  }
  const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom)) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "生效时间无效" }, { status: 400 });
  }
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  const rule = await prisma.feeRule.create({
    data: {
      site: String(body.site || "MY"),
      feeType: feeType as never,
      category: String(body.category || "*"),
      shopType: shopType as never,
      bxpStatus: bxpStatus as never,
      rate,
      fixedAmount,
      perUnit: perUnit as never,
      effectiveFrom,
      effectiveTo,
      version: 1,
      status: "DRAFT",
      source: body.source ? String(body.source) : null,
      note: body.note ? String(body.note) : null,
    },
  });

  await audit(admin.userId, "CREATE", "FeeRule", rule.id, null, { feeType, category: rule.category, status: "DRAFT" });
  return NextResponse.json({ ok: true, rule: ser(rule) });
}
