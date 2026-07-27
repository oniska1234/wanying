import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlan } from "@/lib/my-profit/quota";
import { makeExportToken, verifyExportToken } from "@/lib/my-profit/export-token";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待评估",
  CANDIDATE: "候选",
  SAMPLING: "打样",
  ABANDONED: "放弃",
  LISTED: "已上架",
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function buildCsv(userId: string): Promise<string> {
  const products = await prisma.product.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      skus: { include: { calculations: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  });

  const header = [
    "商品名称", "状态", "类目", "店铺类型", "BXP", "标签",
    "原价(RM)", "卖家折扣(RM)", "成本币种", "汇率(CNY/MYR)",
    "净利润(RM)", "净利率(%)", "保本价(RM)", "最高采购价", "备注", "更新时间",
  ];
  const rows: string[] = [header.map(csvCell).join(",")];

  for (const p of products) {
    const sku = p.skus[0];
    const calc = sku?.calculations[0];
    const netMarginPct = calc ? (Number(calc.netMargin) * 100).toFixed(2) : "";
    rows.push(
      [
        p.name,
        STATUS_LABEL[p.status] || p.status,
        p.category,
        p.shopType,
        p.bxpStatus,
        p.tags.join(" / "),
        sku ? Number(sku.originalPrice).toFixed(2) : "",
        sku ? Number(sku.sellerDiscount).toFixed(2) : "",
        sku?.costCurrency || "",
        sku ? Number(sku.exchangeRate).toFixed(4) : "",
        calc ? Number(calc.netProfit).toFixed(2) : "",
        netMarginPct,
        calc?.breakEvenPrice === null ? "" : calc ? Number(calc.breakEvenPrice).toFixed(2) : "",
        calc?.maxPurchasePrice === null ? "" : calc ? Number(calc.maxPurchasePrice).toFixed(2) : "",
        p.note || "",
        p.updatedAt.toISOString().slice(0, 19).replace("T", " "),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // BOM 便于 Excel 正确识别 UTF-8
  return "\uFEFF" + rows.join("\n");
}

/**
 * GET /api/my-profit/products/export
 * - 无 token：校验登录 + Pro，返回短时导出链接
 * - 有 token（uid/exp/sig）：校验签名与有效期，返回 CSV 文件
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uid = searchParams.get("uid");
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");

  // 模式 2：凭令牌下载
  if (uid && exp && sig) {
    if (!verifyExportToken(uid, exp, sig)) {
      return NextResponse.json({ error: "链接无效或已过期，请重新生成" }, { status: 403 });
    }
    const csv = await buildCsv(uid);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="my-profit-products-${Date.now()}.csv"`,
      },
    });
  }

  // 模式 1：生成短时链接
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const plan = await getPlan(session.user.id);
  if (plan !== "PRO") {
    return NextResponse.json({ error: "CSV 导出为 Pro 功能，请使用兑换码升级。" }, { status: 403 });
  }
  const token = makeExportToken(session.user.id);
  return NextResponse.json(token);
}
