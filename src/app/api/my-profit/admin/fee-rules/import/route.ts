import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, adminDenied, audit } from "@/lib/my-profit/admin";

export const dynamic = "force-dynamic";

const FEE_TYPES = ["COMMISSION", "TRANSACTION", "PLATFORM_SUPPORT"];
const SHOP_TYPES = ["MARKETPLACE", "MALL"];
const BXP = ["BXP", "NON_BXP", "UNCERTAIN"];
const UNITS = ["ORDER", "ITEM", "REVENUE"];

/** 简易 CSV 解析（支持引号包裹） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((x) => x.trim() !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  cur.push(field);
  if (cur.some((x) => x.trim() !== "")) rows.push(cur);
  return rows;
}

/**
 * POST /api/my-profit/admin/fee-rules/import
 * body: { csv: string }
 * CSV 表头：feeType,category,shopType,bxpStatus,rate,fixedAmount,perUnit,effectiveFrom,effectiveTo,source
 * 导入为 DRAFT，需手动发布。
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return adminDenied();

  let body: { csv?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const csv = String(body.csv || "").replace(/^\uFEFF/, "");
  if (!csv.trim()) return NextResponse.json({ error: "CSV 内容为空" }, { status: 400 });

  const rows = parseCsv(csv);
  if (rows.length < 2) return NextResponse.json({ error: "CSV 至少包含表头和一行数据" }, { status: 400 });

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const required = ["feetype", "category", "shoptype", "bxpstatus"];
  for (const r of required) {
    if (idx(r) === -1) return NextResponse.json({ error: `缺少列：${r}` }, { status: 400 });
  }

  let imported = 0;
  const errors: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const feeType = (row[idx("feetype")] || "").trim().toUpperCase();
    const shopType = (row[idx("shoptype")] || "MARKETPLACE").trim().toUpperCase();
    const bxpStatus = (row[idx("bxpstatus")] || "NON_BXP").trim().toUpperCase();
    const perUnit = (idx("perunit") >= 0 ? row[idx("perunit")] : "ORDER").trim().toUpperCase() || "ORDER";
    if (!FEE_TYPES.includes(feeType)) { errors.push(`第${line}行：费用类型无效`); continue; }
    if (!SHOP_TYPES.includes(shopType)) { errors.push(`第${line}行：店铺类型无效`); continue; }
    if (!BXP.includes(bxpStatus)) { errors.push(`第${line}行：BXP 状态无效`); continue; }
    if (!UNITS.includes(perUnit)) { errors.push(`第${line}行：计费单位无效`); continue; }

    const rateRaw = idx("rate") >= 0 ? row[idx("rate")]?.trim() : "";
    const fixedRaw = idx("fixedamount") >= 0 ? row[idx("fixedamount")]?.trim() : "";
    const rate = rateRaw ? Number(rateRaw) : null;
    const fixedAmount = fixedRaw ? Number(fixedRaw) : null;
    if (rate === null && fixedAmount === null) { errors.push(`第${line}行：费率与固定金额至少一项`); continue; }

    const fromRaw = idx("effectivefrom") >= 0 ? row[idx("effectivefrom")]?.trim() : "";
    const effectiveFrom = fromRaw ? new Date(fromRaw) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) { errors.push(`第${line}行：生效时间无效`); continue; }
    const toRaw = idx("effectiveto") >= 0 ? row[idx("effectiveto")]?.trim() : "";
    const effectiveTo = toRaw ? new Date(toRaw) : null;

    await prisma.feeRule.create({
      data: {
        site: "MY",
        feeType: feeType as never,
        category: (row[idx("category")] || "*").trim() || "*",
        shopType: shopType as never,
        bxpStatus: bxpStatus as never,
        rate,
        fixedAmount,
        perUnit: perUnit as never,
        effectiveFrom,
        effectiveTo: effectiveTo && !Number.isNaN(effectiveTo.getTime()) ? effectiveTo : null,
        version: 1,
        status: "DRAFT",
        source: idx("source") >= 0 ? row[idx("source")]?.trim() || null : null,
      },
    });
    imported++;
  }

  await audit(admin.userId, "IMPORT", "FeeRule", undefined, null, { imported, errorCount: errors.length });
  return NextResponse.json({ ok: true, imported, errors });
}
