/**
 * Prisma 种子脚本：导入 TikTok Shop 马来站费率规则
 * 运行：npx prisma db seed
 *
 * 费率来源：TikTok Shop MY Seller Center 公开费率（2026 参考值）
 * 注意：以下为参考费率，正式使用前请核对官方最新公告。
 */
import { PrismaClient, FeeType, FeeUnit, ShopType, BxpStatus, RuleStatus } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = {
  commission: "https://seller-my.tiktok.com/university/essay?knowledge_id=6907739532281602",
  transaction: "https://seller-my.tiktok.com/university/essay?knowledge_id=10013511",
  psf: "https://seller-my.tiktok.com/university/essay?knowledge_id=7992113007347457",
};

const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00Z");

interface SeedRule {
  feeType: FeeType;
  category: string;
  shopType: ShopType;
  bxpStatus: BxpStatus;
  rate: number | null;
  fixedAmount: number | null;
  perUnit: FeeUnit;
  source: string;
}

/** 佣金费率（按类目 + 店铺类型 + BXP） */
const commissionRules: SeedRule[] = [
  // Marketplace 非BXP
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.05, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.06, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  { feeType: FeeType.COMMISSION, category: "Fashion", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.05, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  { feeType: FeeType.COMMISSION, category: "Beauty & Personal Care", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.055, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  // Marketplace BXP（更低）
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.04, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.05, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  // Mall 非BXP（更高）
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.06, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  { feeType: FeeType.COMMISSION, category: "Electronics", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.07, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
  // Mall BXP
  { feeType: FeeType.COMMISSION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.05, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.commission },
];

/** 交易费（统一 2%，按店铺/BXP 区分） */
const transactionRules: SeedRule[] = [
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: 0.02, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction },
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: 0.02, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction },
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: 0.02, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction },
  { feeType: FeeType.TRANSACTION, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: 0.02, fixedAmount: null, perUnit: FeeUnit.REVENUE, source: SOURCE.transaction },
];

/** 平台支持费（按订单固定金额） */
const psfRules: SeedRule[] = [
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.NON_BXP, rate: null, fixedAmount: 1.0, perUnit: FeeUnit.ORDER, source: SOURCE.psf },
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MARKETPLACE, bxpStatus: BxpStatus.BXP, rate: null, fixedAmount: 1.0, perUnit: FeeUnit.ORDER, source: SOURCE.psf },
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.NON_BXP, rate: null, fixedAmount: 1.5, perUnit: FeeUnit.ORDER, source: SOURCE.psf },
  { feeType: FeeType.PLATFORM_SUPPORT, category: "*", shopType: ShopType.MALL, bxpStatus: BxpStatus.BXP, rate: null, fixedAmount: 1.5, perUnit: FeeUnit.ORDER, source: SOURCE.psf },
];

const ALL_RULES = [...commissionRules, ...transactionRules, ...psfRules];

async function main() {
  console.log("Seeding fee rules...");

  // 幂等：先清理已存在的种子规则（按 site=MY 且 version=1）
  const existing = await prisma.feeRule.count({ where: { site: "MY" } });
  if (existing > 0) {
    console.log(`Found ${existing} existing MY rules, skipping seed (idempotent).`);
    return;
  }

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
        effectiveFrom: EFFECTIVE_FROM,
        version: 1,
        status: RuleStatus.PUBLISHED,
        source: r.source,
        note: "种子数据：TikTok Shop MY 参考费率",
      },
    });
    count++;
  }

  // 默认参考汇率 CNY/MYR（1 MYR = 1.62 CNY）
  await prisma.exchangeRate.create({
    data: {
      fromCurrency: "MYR",
      toCurrency: "CNY",
      rate: 1.62,
      source: "seed-reference",
      isRealtime: false,
    },
  });

  console.log(`Seeded ${count} fee rules + 1 reference exchange rate.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
