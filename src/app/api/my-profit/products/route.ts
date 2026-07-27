import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkQuota } from "@/lib/my-profit/quota";

export const dynamic = "force-dynamic";

/** Decimal -> Number（用于 JSON 输出） */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v as never);
  return Number.isFinite(n) ? n : 0;
}

/** 序列化 SKU + 最新计算 */
function serializeSku(sku: {
  id: string;
  name: string | null;
  originalPrice: unknown;
  sellerDiscount: unknown;
  exchangeRate: unknown;
  costCurrency: string;
  calculations?: Array<{
    id: string;
    netProfit: unknown;
    netMargin: unknown;
    breakEvenPrice: unknown;
    maxPurchasePrice: unknown;
    feeRuleVersion: string | null;
    resultSnapshot: unknown;
    createdAt: Date;
  }>;
}) {
  const latest = sku.calculations?.[0];
  return {
    id: sku.id,
    name: sku.name,
    originalPrice: num(sku.originalPrice),
    sellerDiscount: num(sku.sellerDiscount),
    costCurrency: sku.costCurrency,
    exchangeRate: num(sku.exchangeRate),
    calculation: latest
      ? {
          id: latest.id,
          netProfit: num(latest.netProfit),
          netMargin: num(latest.netMargin),
          breakEvenPrice: latest.breakEvenPrice === null ? null : num(latest.breakEvenPrice),
          maxPurchasePrice: latest.maxPurchasePrice === null ? null : num(latest.maxPurchasePrice),
          feeRuleVersion: latest.feeRuleVersion,
          resultSnapshot: latest.resultSnapshot,
          createdAt: latest.createdAt,
        }
      : null,
  };
}

/**
 * GET /api/my-profit/products?q=&status=&sort=&tag=
 * 列出当前用户的选品清单（含 SKU 与最新计算）
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const status = searchParams.get("status");
  const tag = searchParams.get("tag")?.trim();
  const sort = searchParams.get("sort") || "updatedAt_desc";

  const where: Record<string, unknown> = { userId: session.user.id };
  if (status && status !== "ALL") where.status = status;
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (tag) where.tags = { has: tag };

  const [sortField, sortDir] = sort.split("_");
  const orderBy = { [sortField || "updatedAt"]: sortDir === "asc" ? "asc" : "desc" };

  const products = await prisma.product.findMany({
    where,
    orderBy,
    include: {
      skus: {
        include: {
          calculations: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  return NextResponse.json({
    count: products.length,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      category: p.category,
      shopType: p.shopType,
      bxpStatus: p.bxpStatus,
      status: p.status,
      tags: p.tags,
      note: p.note,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      skus: p.skus.map(serializeSku),
    })),
  });
}

/**
 * POST /api/my-profit/products
 * 保存计算快照到选品清单。
 * body: { name, category, shopType, bxpStatus, url?, tags?, note?, sku: { name?, form, result, feeRuleVersion? } }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 额度检查（免费版限制保存数量）
  const quota = await checkQuota(session.user.id);
  if (!quota.canSave) {
    return NextResponse.json(
      { error: `免费版最多保存 ${quota.maxProducts} 个商品，升级 Pro 解锁无限选品。`, quota },
      { status: 403 }
    );
  }

  let body: {
    name?: string;
    category?: string;
    shopType?: string;
    bxpStatus?: string;
    url?: string;
    tags?: string[];
    note?: string;
    sku?: {
      name?: string;
      form?: Record<string, number | string>;
      result?: Record<string, unknown>;
      feeRuleVersion?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "商品名称必填" }, { status: 400 });
  const form = body.sku?.form || {};
  const result = body.sku?.result || {};

  const f = (k: string) => {
    const v = Number(form[k]);
    return Number.isFinite(v) ? v : 0;
  };
  const ratio = (k: string) => f(k) / 100; // 百分比 -> 比例

  const product = await prisma.product.create({
    data: {
      userId: session.user.id,
      name: name.slice(0, 100),
      url: body.url || null,
      category: body.category || "",
      shopType: (body.shopType as "MARKETPLACE" | "MALL") || "MARKETPLACE",
      bxpStatus: (body.bxpStatus as "BXP" | "NON_BXP" | "UNCERTAIN") || "NON_BXP",
      status: "PENDING",
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 10).map((t) => String(t).slice(0, 20)) : [],
      note: body.note || null,
      skus: {
        create: {
          name: body.sku?.name || null,
          originalPrice: f("originalPrice"),
          sellerDiscount: f("sellerDiscount"),
          platformDiscount: f("platformDiscount"),
          buyerShipping: f("buyerShipping"),
          quantity: Math.max(1, Math.round(f("quantity"))),
          costCurrency: String(form.costCurrency || "CNY"),
          purchasePrice: f("purchasePrice"),
          domesticShipping: f("domesticShipping"),
          packagingCost: f("packagingCost"),
          crossBorderLogistics: f("crossBorderLogistics"),
          localFulfillment: f("localFulfillment"),
          storageCost: f("storageCost"),
          otherCost: f("otherCost"),
          affiliateRate: ratio("affiliateRate"),
          affiliateFixed: f("affiliateFixed"),
          adRate: ratio("adRate"),
          adFixed: f("adFixed"),
          refundRate: ratio("refundRate"),
          refundRecovery: f("refundRecovery"),
          refundExtraCost: f("refundExtraCost"),
          exchangeRate: f("exchangeRate") || 1,
          calculations: {
            create: {
              inputSnapshot: form as object,
              resultSnapshot: result as object,
              feeRuleVersion: body.sku?.feeRuleVersion || null,
              exchangeRateValue: f("exchangeRate") || 1,
              netProfit: Number(result.netProfit) || 0,
              netMargin: Number(result.netMargin) || 0,
              breakEvenPrice:
                result.breakEvenPrice === null || result.breakEvenPrice === undefined
                  ? null
                  : Number(result.breakEvenPrice),
              maxPurchasePrice:
                result.maxPurchasePrice === null || result.maxPurchasePrice === undefined
                  ? null
                  : Number(result.maxPurchasePrice),
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ ok: true, id: product.id });
}
