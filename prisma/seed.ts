/**
 * Prisma 种子脚本：导入 TikTok Shop 马来站费率规则 v2
 * 运行：npx prisma db seed
 *
 * 费率来源：TikTok Shop MY Seller Center 官方公开费率
 * 更新日期：2026-07-27（基于 2026-06-06 官方页面）
 * 生效日期：2025-09-13（佣金调整）/ 2024-09-05（交易费调整）/ 2026-02-15（交易费公式调整）
 *
 * 注意：佣金按 L1 类目提供代表性费率（SST inclusive）。
 * 实际子类目费率可能不同，工具会在结果中标注"参考费率"。
 */
import { PrismaClient, FeeType, FeeUnit, ShopType, BxpStatus, RuleStatus } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = {
  commission: "https://seller-my.tiktok.com/university/essay?knowledge_id=6907739532281602",
  transaction: "https://seller-my.tiktok.com/university/essay?knowledge_id=10013511",
  psf: "https://seller-my.tiktok.com/university/essay?knowledge_id=7992113007347457",
};

/** 佣金生效日期：2025-09-13 费率调整 */
const COMMISSION_EFFECTIVE = new Date("2025-09-13T00:00:00+08:00");
/** 交易费生效日期：2024-09-05 费率调整为 3.78% */
const TRANSACTION_EFFECTIVE = new Date("2024-09-05T00:00:00+08:00");
/** 平台支持费生效日期 */
const PSF_EFFECTIVE = new Date("2024-09-05T00:00:00+08:00");

interface SeedRule {
  feeType: FeeType;
  category: string;
  shopType: ShopType;
  bxpStatus: BxpStatus;
  rate: number | null;
  fixedAmount: number | null;
  perUnit: FeeUnit;
  source: string;
  effectiveFrom: Date;
  note: string;
}

/**
 * 佣金费率 v2（SST inclusive，2025-09-13 起生效）
 * 基于官方子类目表的 L1 代表性费率：
 * - Electronics: 多数子类目 5.40%(BXP-MP) / 9.72%(non-BXP-MP) / 8.64%(BXP-Mall) / 12.96%(non-BXP-Mall)
 * - Fashion: 统一 10.26% / 14.58% / 13.50% / 17.82%
 * - Beauty & Personal Care: 多数 10.80% / 15.12% / 14.04% / 18.36%
 * - Home & Living (Lifestyle): 多数 8.10% / 12.42% / 11.34% / 15.66%
 * - 通用默认: 取中位 8.10% / 12.42% / 11.34% / 15.66%
 */
const commissionRules: SeedRule[] = [
  // === 通用默认（未选类目时使用） ===
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.0810, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: L1 中位代表性费率 (SST inclusive)" },
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.1242, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: L1 中位代表性费率 (SST inclusive)" },
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.1134, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: L1 中位代表性费率 (SST inclusive)" },
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.1566, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: L1 中位代表性费率 (SST inclusive)" },

  // === Electronics (代表性: Phones/Tablets/Appliances 5.40% 系列) ===
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.0540, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Electronics 代表费率 (多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.0972, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Electronics 代表费率 (多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.0864, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Electronics 代表费率 (多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.1296, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Electronics 代表费率 (多数子类目)" },

  // === Fashion (统一费率) ===
  { feeType: FeeType.COMMISSION, category: "Fashion", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.1026, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Fashion 统一费率" },
  { feeType: FeeType.COMMISSION, category: "Fashion", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.1458, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Fashion 统一费率" },
  { feeType: FeeType.COMMISSION, category: "Fashion", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.1350, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Fashion 统一费率" },
  { feeType: FeeType.COMMISSION, category: "Fashion", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.1782, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Fashion 统一费率" },

  // === Home & Living (Lifestyle 类目代表: 8.10% 系列) ===
  { feeType: FeeType.COMMISSION, category: "Home & Living", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.0810, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Home & Living 代表费率 (Lifestyle 多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Home & Living", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.1242, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Home & Living 代表费率 (Lifestyle 多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Home & Living", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.1134, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Home & Living 代表费率 (Lifestyle 多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Home & Living", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.1566, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Home & Living 代表费率 (Lifestyle 多数子类目)" },

  // === Beauty & Personal Care (多数子类目 10.80% 系列) ===
  { feeType: FeeType.COMMISSION, category: "Beauty & Personal Care", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.1080, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Beauty 代表费率 (多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Beauty & Personal Care", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.1512, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Beauty 代表费率 (多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Beauty & Personal Care", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.1404, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Beauty 代表费率 (多数子类目)" },
  { feeType: FeeType.COMMISSION, category: "Beauty & Personal Care", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.1836, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission, effectiveFrom: COMMISSION_EFFECTIVE, note: "v2: Beauty 代表费率 (多数子类目)" },
];

/**
 * 交易费 v2: 3.78% (SST inclusive)
 * 自 2024-09-05 起生效，适用所有卖家
 * 公式 (2026-02-15 起): (Original Price - Seller Discount + Buyer Shipping) × 3.78%
 */
const transactionRules: SeedRule[] = [
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.0378, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction, effectiveFrom: TRANSACTION_EFFECTIVE, note: "v2: 3.78% SST inclusive (2024-09-05 起)" },
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.0378, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction, effectiveFrom: TRANSACTION_EFFECTIVE, note: "v2: 3.78% SST inclusive (2024-09-05 起)" },
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.0378, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction, effectiveFrom: TRANSACTION_EFFECTIVE, note: "v2: 3.78% SST inclusive (2024-09-05 起)" },
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.0378, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction, effectiveFrom: TRANSACTION_EFFECTIVE, note: "v2: 3.78% SST inclusive (2024-09-05 起)" },
];

/**
 * 平台支持费 v2: RM 0.54/成功交付订单 (SST inclusive)
 * 适用所有卖家，不区分店铺类型/BXP
 */
const psfRules: SeedRule[] = [
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: null, fixedAmount: 0.54, perUnit: FeeUnit.ORDER, source: SOURCE.psf, effectiveFrom: PSF_EFFECTIVE, note: "v2: RM0.54/订单 (SST inclusive)" },
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: null, fixedAmount: 0.54, perUnit: FeeUnit.ORDER, source: SOURCE.psf, effectiveFrom: PSF_EFFECTIVE, note: "v2: RM0.54/订单 (SST inclusive)" },
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: null, fixedAmount: 0.54, perUnit: FeeUnit.ORDER, source: SOURCE.psf, effectiveFrom: PSF_EFFECTIVE, note: "v2: RM0.54/订单 (SST inclusive)" },
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: null, fixedAmount: 0.54, perUnit: FeeUnit.ORDER, source: SOURCE.psf, effectiveFrom: PSF_EFFECTIVE, note: "v2: RM0.54/订单 (SST inclusive)" },
];

const ALL_RULES = [...commissionRules, ...transactionRules, ...psfRules];

async function main() {
  console.log("Seeding fee rules v2...");

  // 归档所有旧版 v1 规则
  const oldRules = await prisma.feeRule.findMany({
    where: { site: "MY", status: RuleStatus.PUBLISHED },
  });

  if (oldRules.length > 0) {
    console.log(`Archiving ${oldRules.length} old PUBLISHED rules...`);
    await prisma.feeRule.updateMany({
      where: { site: "MY", status: RuleStatus.PUBLISHED },
      data: { status: RuleStatus.ARCHIVED },
    });
  }

  // 也归档 DRAFT 旧规则
  await prisma.feeRule.updateMany({
    where: { site: "MY", status: RuleStatus.DRAFT },
    data: { status: RuleStatus.ARCHIVED },
  });

  // 插入 v2 规则
  let count = 0;
  for (const r of ALL_RULES) {
    await prisma.feeRule.create({
      data: {
        site: "MY",
        feeType: r.feeType,
        category: r.category,
        shopType: r.shopType,
        bxpStatus: r.bxpStatus,
        rate: r.rate,
        fixedAmount: r.fixedAmount,
        perUnit: r.perUnit,
        effectiveFrom: r.effectiveFrom,
        version: 2,
        status: RuleStatus.PUBLISHED,
        source: r.source,
        note: r.note,
      },
    });
    count++;
  }

  console.log(`Seeded ${count} fee rules v2 (official rates 2025-09-13 / 2024-09-05).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
