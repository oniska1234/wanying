import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import * as XLSX from "xlsx";
import { validateForm, buildInput, type ProfitFormValues } from "@/lib/my-profit/defaults";
import { calculate } from "@/lib/my-profit/calculator";
import type { RawFeeRule } from "@/lib/my-profit/fee-engine";
import { FREE_LIMITS } from "@/lib/my-profit/quota";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const MAX_ROWS = 100;

/** 中文表头 -> 表单字段映射 */
const HEADER_MAP: Record<string, keyof ProfitFormValues | "name"> = {
  "商品名称": "name",
  "商品原价(RM)": "originalPrice",
  "卖家折扣(RM)": "sellerDiscount",
  "平台折扣(RM)": "platformDiscount",
  "买家运费(RM)": "buyerShipping",
  "数量": "quantity",
  "成本币种": "costCurrency",
  "采购成本": "purchasePrice",
  "国内运费": "domesticShipping",
  "包材费": "packagingCost",
  "头程物流": "crossBorderLogistics",
  "尾程履约": "localFulfillment",
  "仓储费": "storageCost",
  "其他成本": "otherCost",
  "达人佣金(%)": "affiliateRate",
  "广告费(%)": "adRate",
  "退款率(%)": "refundRate",
  "汇率(CNY/MYR)": "exchangeRate",
  "店铺类型": "shopType",
  "BXP状态": "bxpStatus",
  "类目": "category",
};

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface ParsedRow {
  name: string;
  form: ProfitFormValues;
  category: string;
  shopType: string;
  bxpStatus: string;
}

function num(v: unknown, def: number): number {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(v: unknown, def: string): string {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  return s || def;
}

/**
 * POST /api/my-profit/import
 * 批量导入 Excel 选品数据
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 解析 multipart/form-data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式无效，请使用 multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "请上传 Excel 文件" }, { status: 400 });
  }

  // 读取文件
  let wb: XLSX.WorkBook;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    wb = XLSX.read(buf, { type: "buffer" });
  } catch {
    return NextResponse.json({ error: "无法解析 Excel 文件，请确认格式正确" }, { status: 400 });
  }

  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 2) {
    return NextResponse.json({ error: "Excel 中没有数据行" }, { status: 400 });
  }

  // 解析表头
  const headerRow = rows[0] as string[];
  const colMap: number[] = []; // colMap[i] = index in HEADER_MAP keys
  const headerKeys = Object.keys(HEADER_MAP);
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i]).trim();
    colMap[i] = headerKeys.indexOf(h);
  }

  // 跳过表头行 + 示例行/说明行（如果第二行包含"必填"或"示例"则跳过）
  let dataStart = 1;
  const secondRow = rows[1] as string[];
  if (secondRow && (String(secondRow[0]).includes("必填") || String(secondRow[0]).includes("示例"))) {
    dataStart = 2;
    // 如果第三行也是说明行
    const thirdRow = rows[2] as string[];
    if (thirdRow && (String(thirdRow[0]).includes("必填") || String(thirdRow[0]).includes("选填"))) {
      dataStart = 3;
    }
  }

  const dataRows = rows.slice(dataStart).filter((r) => r.some((c) => c !== ""));
  if (dataRows.length === 0) {
    return NextResponse.json({ error: "Excel 中没有有效数据行" }, { status: 400 });
  }
  if (dataRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `单次最多导入 ${MAX_ROWS} 行，当前 ${dataRows.length} 行` }, { status: 400 });
  }

  // 逐行解析
  const errors: RowError[] = [];
  const parsed: ParsedRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = dataStart + i + 1; // Excel 行号（1-based）

    // 构建字段值
    const values: Record<string, unknown> = {};
    for (let col = 0; col < row.length && col < colMap.length; col++) {
      const idx = colMap[col];
      if (idx >= 0) {
        values[headerKeys[idx]] = row[col];
      }
    }

    const name = str(values["商品名称"], "");
    if (!name) {
      errors.push({ row: rowNum, field: "商品名称", message: "商品名称必填" });
      continue;
    }

    const form: ProfitFormValues = {
      originalPrice: num(values["商品原价(RM)"], 0),
      sellerDiscount: num(values["卖家折扣(RM)"], 0),
      platformDiscount: num(values["平台折扣(RM)"], 0),
      buyerShipping: num(values["买家运费(RM)"], 0),
      otherIncome: 0,
      quantity: Math.max(1, Math.round(num(values["数量"], 1))),
      costCurrency: (str(values["成本币种"], "CNY").toUpperCase() === "MYR" ? "MYR" : "CNY") as "CNY" | "MYR",
      purchasePrice: num(values["采购成本"], 0),
      domesticShipping: num(values["国内运费"], 0),
      packagingCost: num(values["包材费"], 0),
      crossBorderLogistics: num(values["头程物流"], 0),
      localFulfillment: num(values["尾程履约"], 0),
      storageCost: num(values["仓储费"], 0),
      otherCost: num(values["其他成本"], 0),
      affiliateRate: num(values["达人佣金(%)"], 10),
      affiliateFixed: 0,
      adRate: num(values["广告费(%)"], 8),
      adFixed: 0,
      refundRate: num(values["退款率(%)"], 3),
      refundRecovery: 0,
      refundExtraCost: 0,
      exchangeRate: num(values["汇率(CNY/MYR)"], 1.62),
      shopType: (str(values["店铺类型"], "MARKETPLACE").toUpperCase() === "MALL" ? "MALL" : "MARKETPLACE") as "MARKETPLACE" | "MALL",
      bxpStatus: (() => {
        const v = str(values["BXP状态"], "NON_BXP").toUpperCase();
        if (v === "BXP") return "BXP" as const;
        if (v === "UNCERTAIN") return "UNCERTAIN" as const;
        return "NON_BXP" as const;
      })(),
      category: str(values["类目"], ""),
    };

    // 校验
    const validationErrors = validateForm(form);
    if (validationErrors.length > 0) {
      for (const ve of validationErrors) {
        errors.push({ row: rowNum, field: ve.field, message: ve.message });
      }
      continue;
    }

    parsed.push({
      name: name.slice(0, 100),
      form,
      category: form.category,
      shopType: form.shopType,
      bxpStatus: form.bxpStatus,
    });
  }

  if (parsed.length === 0) {
    return NextResponse.json({ total: dataRows.length, success: 0, failed: dataRows.length, errors, quotaHit: false });
  }

  // 加载费率规则（一次性）
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

  // 服务端计算每行
  const calcResults: Array<{ row: ParsedRow; result: ReturnType<typeof calculate>; matchLevel: string }> = [];
  for (const row of parsed) {
    try {
      const input = buildInput(row.form, rules);
      const result = calculate(input);
      calcResults.push({ row, result, matchLevel: input.feeRules.matchLevel });
    } catch {
      errors.push({ row: 0, field: "calculation", message: `${row.name}: 计算失败` });
    }
  }

  // 批量保存（事务 + advisory lock 额度检查）
  let successCount = 0;
  let quotaHit = false;

  try {
    await prisma.$transaction(async (tx) => {
      const lockKey = BigInt(parseInt(session.user!.id.replace(/[^0-9a-f]/gi, "").slice(0, 14), 16) % Number.MAX_SAFE_INTEGER);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

      const currentCount = await tx.product.count({ where: { userId: session.user!.id } });

      // 检查是否为 Pro
      const plan = await tx.subscription.findFirst({
        where: { userId: session.user!.id, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });
      const isPro = plan?.plan === "PRO" && (!plan.expiresAt || plan.expiresAt.getTime() > Date.now());
      const maxAllowed = isPro ? Infinity : FREE_LIMITS.maxProducts;
      const remaining = Math.max(0, maxAllowed - currentCount);

      const toSave = calcResults.slice(0, remaining);
      if (calcResults.length > remaining) {
        quotaHit = true;
        for (let i = remaining; i < calcResults.length; i++) {
          errors.push({ row: 0, field: "quota", message: `${calcResults[i].row.name}: 超出免费额度（最多 ${FREE_LIMITS.maxProducts} 条）` });
        }
      }

      for (const item of toSave) {
        const { row, result, matchLevel } = item;
        const categoryWarning = row.category && matchLevel === "default"
          ? "该类目未找到精确费率规则，已使用通用默认费率，利润结果仅供参考"
          : undefined;

        await tx.product.create({
          data: {
            userId: session.user!.id,
            name: row.name,
            category: row.category,
            shopType: row.shopType as "MARKETPLACE" | "MALL",
            bxpStatus: row.bxpStatus as "BXP" | "NON_BXP" | "UNCERTAIN",
            status: "PENDING",
            tags: [],
            skus: {
              create: {
                originalPrice: row.form.originalPrice,
                sellerDiscount: row.form.sellerDiscount,
                platformDiscount: row.form.platformDiscount,
                buyerShipping: row.form.buyerShipping,
                quantity: row.form.quantity,
                costCurrency: row.form.costCurrency,
                purchasePrice: row.form.purchasePrice,
                domesticShipping: row.form.domesticShipping,
                packagingCost: row.form.packagingCost,
                crossBorderLogistics: row.form.crossBorderLogistics,
                localFulfillment: row.form.localFulfillment,
                storageCost: row.form.storageCost,
                otherCost: row.form.otherCost,
                affiliateRate: row.form.affiliateRate / 100,
                adRate: row.form.adRate / 100,
                refundRate: row.form.refundRate / 100,
                exchangeRate: row.form.exchangeRate,
                calculations: {
                  create: {
                    inputSnapshot: row.form as unknown as object,
                    resultSnapshot: JSON.parse(JSON.stringify(
                      { ...result, matchLevel, ...(categoryWarning ? { ruleWarning: categoryWarning } : {}) },
                      (k, v) => typeof v === "object" && v !== null && v.constructor?.name === "Decimal" ? v.toString() : v
                    )),
                    feeRuleVersion: result.feeRuleVersions?.join(",") || null,
                    exchangeRateValue: row.form.exchangeRate,
                    netProfit: result.netProfit.toNumber(),
                    netMargin: Math.max(-9.9999, Math.min(9.9999, result.netMargin.toNumber())),
                    breakEvenPrice: result.breakEvenPrice?.toNumber() ?? null,
                    maxPurchasePrice: result.maxPurchasePrice?.toNumber() ?? null,
                  },
                },
              },
            },
          },
        });
        successCount++;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("deadlock") || msg.includes("write conflict")) {
      return NextResponse.json({ error: "服务器繁忙，请重试" }, { status: 503 });
    }
    return NextResponse.json({ error: "批量保存失败，请重试" }, { status: 500 });
  }

  return NextResponse.json({
    total: dataRows.length,
    success: successCount,
    failed: dataRows.length - successCount,
    errors: errors.slice(0, 50), // 最多返回50条错误
    quotaHit,
  });
}
