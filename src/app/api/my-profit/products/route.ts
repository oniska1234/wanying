import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkQuota, FREE_LIMITS } from "@/lib/my-profit/quota";
import { validateForm, buildInput, type ProfitFormValues } from "@/lib/my-profit/defaults";
import { calculate } from "@/lib/my-profit/calculator";
import type { RawFeeRule } from "@/lib/my-profit/fee-engine";
import { Prisma } from "@prisma/client";

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
 * body: { name, category, shopType, bxpStatus, url?, tags?, note?, sku: { form, result, feeRuleVersion? } }
 * 服务端重新计算利润，不信任客户端提交的 result。
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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
    return NextResponse.json({ error: "请求体无效", code: "INVALID_BODY" }, { status: 400 });
  }

  // === P1-003: 强制校验必填字段 ===
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "商品名称必填", code: "NAME_REQUIRED" }, { status: 400 });
  if (!body.sku) return NextResponse.json({ error: "缺少 sku 字段，保存必须包含计算快照", code: "SKU_REQUIRED" }, { status: 400 });
  if (!body.sku.form || Object.keys(body.sku.form).length === 0) {
    return NextResponse.json({ error: "缺少 sku.form，无法重建计算输入", code: "FORM_REQUIRED" }, { status: 400 });
  }

  // === P1-004: 服务端校验 form 合法性 ===
  const form = body.sku.form as unknown as ProfitFormValues;
  const validationErrors = validateForm(form);
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "输入校验失败", code: "VALIDATION_FAILED", fields: validationErrors },
      { status: 400 }
    );
  }

  // === P1-002: 服务端重新计算利润 ===
  let serverResult: ReturnType<typeof calculate>;
  try {
    // 从数据库加载当前费率规则
    const dbRules = await prisma.feeRule.findMany({
      where: { site: "MY", status: "PUBLISHED" },
    });
    const rules: RawFeeRule[] = dbRules.map((r) => ({
      id: r.id,
      site: r.site,
      feeType: r.feeType as RawFeeRule["feeType"],
      category: r.category,
      shopType: r.shopType as RawFeeRule["shopType"],
      bxpStatus: r.bxpStatus as RawFeeRule["bxpStatus"],
      rate: r.rate ? Number(r.rate) : null,
      fixedAmount: r.fixedAmount ? Number(r.fixedAmount) : null,
      perUnit: r.perUnit as RawFeeRule["perUnit"],
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      version: r.version,
      source: r.source,
    }));
    const input = buildInput(form, rules);
    serverResult = calculate(input);
  } catch (e) {
    return NextResponse.json(
      { error: "服务端计算失败，请重试", code: "CALC_ERROR" },
      { status: 400 }
    );
  }

  // === P1-001: 事务内额度检查 + 创建（防止并发竞态） ===
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const product = await prisma.$transaction(async (tx) => {
        // 用户级咨询锁：序列化同一用户的并发创建请求（事务结束自动释放）
        const lockKey = BigInt(parseInt(session.user!.id.replace(/[^0-9a-f]/gi, "").slice(0, 14), 16) % Number.MAX_SAFE_INTEGER);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

        // 统计当前用户商品数（已被咨询锁保护，无竞态）
        const currentCount = await tx.product.count({
          where: { userId: session.user!.id },
        });

        // 额度检查
        const plan = await tx.subscription.findFirst({
          where: { userId: session.user!.id, status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
        });
        const isPro = plan?.plan === "PRO" && (!plan.expiresAt || plan.expiresAt.getTime() > Date.now());

        if (!isPro && currentCount >= FREE_LIMITS.maxProducts) {
          throw new QuotaExceededError(currentCount);
        }

        // 创建商品 + SKU + 计算记录
        return tx.product.create({
          data: {
            userId: session.user!.id,
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
                name: body.sku!.name || null,
                originalPrice: Number(form.originalPrice) || 0,
                sellerDiscount: Number(form.sellerDiscount) || 0,
                platformDiscount: Number(form.platformDiscount) || 0,
                buyerShipping: Number(form.buyerShipping) || 0,
                quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
                costCurrency: String(form.costCurrency || "CNY"),
                purchasePrice: Number(form.purchasePrice) || 0,
                domesticShipping: Number(form.domesticShipping) || 0,
                packagingCost: Number(form.packagingCost) || 0,
                crossBorderLogistics: Number(form.crossBorderLogistics) || 0,
                localFulfillment: Number(form.localFulfillment) || 0,
                storageCost: Number(form.storageCost) || 0,
                otherCost: Number(form.otherCost) || 0,
                affiliateRate: (Number(form.affiliateRate) || 0) / 100,
                affiliateFixed: Number(form.affiliateFixed) || 0,
                adRate: (Number(form.adRate) || 0) / 100,
                adFixed: Number(form.adFixed) || 0,
                refundRate: (Number(form.refundRate) || 0) / 100,
                refundRecovery: Number(form.refundRecovery) || 0,
                refundExtraCost: Number(form.refundExtraCost) || 0,
                exchangeRate: Number(form.exchangeRate) || 1,
                calculations: {
                  create: {
                    inputSnapshot: form as unknown as object,
                    resultSnapshot: JSON.parse(JSON.stringify(serverResult, (k, v) => typeof v === "object" && v !== null && v.constructor?.name === "Decimal" ? v.toString() : v)),
                    feeRuleVersion: serverResult.feeRuleVersions?.join(",") || null,
                    exchangeRateValue: Number(form.exchangeRate) || 1,
                    netProfit: serverResult.netProfit.toNumber(),
                    netMargin: Math.max(-9.9999, Math.min(9.9999, serverResult.netMargin.toNumber())),
                    breakEvenPrice: serverResult.breakEvenPrice?.toNumber() ?? null,
                    maxPurchasePrice: serverResult.maxPurchasePrice?.toNumber() ?? null,
                  },
                },
              },
            },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      return NextResponse.json({ ok: true, id: product.id });
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: `免费版最多保存 ${FREE_LIMITS.maxProducts} 个商品，升级 Pro 解锁无限选品。`, quota: { productCount: e.count, maxProducts: FREE_LIMITS.maxProducts } },
          { status: 403 }
        );
      }
      // 瞬态死锁/冲突：重试
      const msg = e instanceof Error ? e.message : "";
      const isTransient = msg.includes("deadlock") || msg.includes("write conflict") || msg.includes("40P01") || msg.includes("40001");
      if (isTransient && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }
      return NextResponse.json({ error: "保存失败，请重试", code: "INTERNAL" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "保存失败，请重试", code: "INTERNAL" }, { status: 500 });
}

class QuotaExceededError extends Error {
  constructor(public count: number) {
    super("Quota exceeded");
  }
}
