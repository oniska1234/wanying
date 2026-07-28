import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/** 模板列定义 */
const COLUMNS = [
  "商品名称", "商品原价(RM)", "卖家折扣(RM)", "平台折扣(RM)", "买家运费(RM)",
  "数量", "成本币种", "采购成本", "国内运费", "包材费",
  "头程物流", "尾程履约", "仓储费", "其他成本",
  "达人佣金(%)", "广告费(%)", "退款率(%)", "汇率(CNY/MYR)",
  "店铺类型", "BXP状态", "类目",
];

const EXAMPLE_ROW = [
  "示例商品-手机壳", 59.9, 10, 0, 0,
  1, "CNY", 25, 3, 2,
  8, 0, 1, 0,
  10, 8, 3, 1.62,
  "MARKETPLACE", "NON_BXP", "Electronics > Phone Accessories",
];

const HELP_ROW = [
  "必填，最长100字", "必填，>0", "选填，>=0", "选填，>=0", "选填，>=0",
  "选填，正整数", "CNY 或 MYR", "选填，>=0", "选填，>=0", "选填，>=0",
  "选填，>=0", "选填，>=0", "选填，>=0", "选填，>=0",
  "选填，0-100", "选填，0-100", "选填，0-100", "选填，>0",
  "MARKETPLACE 或 MALL", "BXP / NON_BXP / UNCERTAIN", "选填，如 Electronics > Phone Accessories",
];

const FIELD_HELP: string[][] = [
  ["字段名", "是否必填", "默认值", "说明"],
  ["商品名称", "是", "-", "商品名称，最长100字符"],
  ["商品原价(RM)", "是", "-", "马来站商品原价（RM），必须大于 0"],
  ["卖家折扣(RM)", "否", "0", "卖家承担的折扣金额，不能大于原价"],
  ["平台折扣(RM)", "否", "0", "平台资助折扣，不影响卖家收入"],
  ["买家运费(RM)", "否", "0", "买家支付的运费"],
  ["数量", "否", "1", "商品数量，正整数"],
  ["成本币种", "否", "CNY", "成本币种：CNY（人民币）或 MYR（马币）"],
  ["采购成本", "否", "0", "采购单价（按成本币种计）"],
  ["国内运费", "否", "0", "国内物流费"],
  ["包材费", "否", "0", "包装材料费"],
  ["头程物流", "否", "0", "跨境头程物流费"],
  ["尾程履约", "否", "0", "目的国尾程履约费"],
  ["仓储费", "否", "0", "海外仓储费"],
  ["其他成本", "否", "0", "其他杂项成本"],
  ["达人佣金(%)", "否", "10", "达人/联盟佣金比例，0-100"],
  ["广告费(%)", "否", "8", "广告投放比例，0-100"],
  ["退款率(%)", "否", "3", "预估退款率，0-100"],
  ["汇率(CNY/MYR)", "否", "1.62", "1 MYR = 多少 CNY，必须大于 0"],
  ["店铺类型", "否", "MARKETPLACE", "MARKETPLACE（普通店）或 MALL（商城店）"],
  ["BXP状态", "否", "NON_BXP", "BXP / NON_BXP / UNCERTAIN"],
  ["类目", "否", "(通用)", "TikTok 类目路径，如 Electronics > Phone Accessories"],
];

/**
 * GET /api/my-profit/import/template
 * 下载 Excel 导入模板
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: 选品数据
  const dataSheet = XLSX.utils.aoa_to_sheet([COLUMNS, EXAMPLE_ROW, HELP_ROW]);
  // 设置列宽
  dataSheet["!cols"] = COLUMNS.map((c) => ({ wch: Math.max(c.length * 2, 14) }));
  XLSX.utils.book_append_sheet(wb, dataSheet, "选品数据");

  // Sheet 2: 字段说明
  const helpSheet = XLSX.utils.aoa_to_sheet(FIELD_HELP);
  helpSheet["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, helpSheet, "字段说明");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="MY-Profit-Import-Template.xlsx"`,
    },
  });
}
