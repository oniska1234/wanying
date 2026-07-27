/**
 * MY Profit 计算引擎 - 费率规则匹配
 * 优先级：自定义 > 精确子类目 > 父类目 > 站点默认
 * 无匹配时阻止计算，要求用户手工输入
 */
import Decimal from "decimal.js";
import type {
  ShopType,
  BxpStatus,
  FeeType,
  FeeRuleMatch,
  FeeMatchResult,
} from "./types";

/** 费率规则原始数据（来自数据库或种子数据） */
export interface RawFeeRule {
  id: string;
  site: string;
  feeType: FeeType;
  category: string;
  shopType: ShopType;
  bxpStatus: BxpStatus;
  rate: number | null;
  fixedAmount: number | null;
  perUnit: "ORDER" | "ITEM" | "REVENUE";
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  source: string | null;
}

/**
 * 匹配费率规则
 * @param rules 所有已发布规则
 * @param site 国家站点
 * @param category 商品类目路径 (如 "Electronics > Phones > Cases")
 * @param shopType 店铺类型
 * @param bxpStatus BXP 状态
 * @param date 计算日期 (默认当前)
 */
export function matchFeeRules(
  rules: RawFeeRule[],
  site: string,
  category: string,
  shopType: ShopType,
  bxpStatus: BxpStatus,
  date: Date = new Date()
): FeeMatchResult {
  const dateStr = date.toISOString();

  // 筛选：站点 + 生效期内 + 店铺类型 + BXP 状态
  const effective = rules.filter((r) => {
    if (r.site !== site) return false;
    if (r.shopType !== shopType) return false;
    // BXP: UNCERTAIN 时匹配 NON_BXP（更保守）
    const targetBxp = bxpStatus === "UNCERTAIN" ? "NON_BXP" : bxpStatus;
    if (r.bxpStatus !== targetBxp) return false;
    // 生效期
    if (r.effectiveFrom > dateStr) return false;
    if (r.effectiveTo && r.effectiveTo < dateStr) return false;
    return true;
  });

  const result: FeeMatchResult = {
    commission: null,
    transaction: null,
    platformSupport: null,
    hasUnmatched: false,
    overrides: {},
  };

  // 对每种费用类型匹配最佳规则
  const feeTypes: FeeType[] = ["COMMISSION", "TRANSACTION", "PLATFORM_SUPPORT"];

  for (const feeType of feeTypes) {
    const candidates = effective.filter((r) => r.feeType === feeType);
    const matched = findBestMatch(candidates, category);

    if (matched) {
      const ruleMatch: FeeRuleMatch = {
        feeType,
        rate: matched.rate !== null ? new Decimal(matched.rate) : null,
        fixedAmount: matched.fixedAmount !== null ? new Decimal(matched.fixedAmount) : null,
        perUnit: matched.perUnit,
        version: matched.version,
        source: matched.source,
        effectiveFrom: matched.effectiveFrom,
      };

      if (feeType === "COMMISSION") result.commission = ruleMatch;
      else if (feeType === "TRANSACTION") result.transaction = ruleMatch;
      else result.platformSupport = ruleMatch;
    } else {
      result.hasUnmatched = true;
    }
  }

  return result;
}

/**
 * 在候选规则中找最佳匹配
 * 优先级：精确类目 > 父类目 > 默认（空类目）
 * 同类目取最新版本
 */
function findBestMatch(candidates: RawFeeRule[], category: string): RawFeeRule | null {
  if (candidates.length === 0) return null;

  // 按类目匹配深度排序
  const scored = candidates.map((rule) => ({
    rule,
    score: categoryMatchScore(rule.category, category),
  }));

  // 过滤掉完全不匹配的（score = -1）
  const matched = scored.filter((s) => s.score >= 0);
  if (matched.length === 0) return null;

  // 按 score 降序，同 score 按 version 降序
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.rule.version - a.rule.version;
  });

  return matched[0].rule;
}

/**
 * 计算类目匹配分数
 * -1 = 不匹配
 * 0 = 默认规则（空类目）
 * >0 = 匹配层级数
 */
function categoryMatchScore(ruleCategory: string, targetCategory: string): number {
  // 空类目 = 站点默认规则
  if (!ruleCategory || ruleCategory === "*") return 0;

  const ruleParts = ruleCategory.split(">").map((s) => s.trim().toLowerCase());
  const targetParts = targetCategory.split(">").map((s) => s.trim().toLowerCase());

  // 逐层匹配
  let score = 0;
  for (let i = 0; i < ruleParts.length; i++) {
    if (i >= targetParts.length) return -1; // 规则比目标更深，不匹配
    if (ruleParts[i] !== targetParts[i]) return -1;
    score++;
  }

  return score;
}

/**
 * 内置示例费率（开发/演示用，后续由数据库替代）
 * 来源：TikTok Shop MY Seller Center 2026年费率
 */
export const DEMO_FEE_RULES: RawFeeRule[] = [
  // Marketplace 非BXP 默认佣金
  {
    id: "demo-comm-mp-default",
    site: "MY",
    feeType: "COMMISSION",
    category: "*",
    shopType: "MARKETPLACE",
    bxpStatus: "NON_BXP",
    rate: 0.05,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=6907739532281602",
  },
  // Marketplace BXP 默认佣金（更低）
  {
    id: "demo-comm-mp-bxp",
    site: "MY",
    feeType: "COMMISSION",
    category: "*",
    shopType: "MARKETPLACE",
    bxpStatus: "BXP",
    rate: 0.04,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=6907739532281602",
  },
  // Mall 默认佣金（更高）
  {
    id: "demo-comm-mall-default",
    site: "MY",
    feeType: "COMMISSION",
    category: "*",
    shopType: "MALL",
    bxpStatus: "NON_BXP",
    rate: 0.06,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=6907739532281602",
  },
  // Electronics 类目佣金（更高）
  {
    id: "demo-comm-electronics",
    site: "MY",
    feeType: "COMMISSION",
    category: "Electronics",
    shopType: "MARKETPLACE",
    bxpStatus: "NON_BXP",
    rate: 0.06,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=6907739532281602",
  },
  // 交易费 - Marketplace
  {
    id: "demo-txn-mp",
    site: "MY",
    feeType: "TRANSACTION",
    category: "*",
    shopType: "MARKETPLACE",
    bxpStatus: "NON_BXP",
    rate: 0.02,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=10013511",
  },
  // 交易费 - BXP
  {
    id: "demo-txn-bxp",
    site: "MY",
    feeType: "TRANSACTION",
    category: "*",
    shopType: "MARKETPLACE",
    bxpStatus: "BXP",
    rate: 0.02,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=10013511",
  },
  // 交易费 - Mall
  {
    id: "demo-txn-mall",
    site: "MY",
    feeType: "TRANSACTION",
    category: "*",
    shopType: "MALL",
    bxpStatus: "NON_BXP",
    rate: 0.02,
    fixedAmount: null,
    perUnit: "REVENUE",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=10013511",
  },
  // 平台支持费 - Marketplace（按订单固定金额）
  {
    id: "demo-psf-mp",
    site: "MY",
    feeType: "PLATFORM_SUPPORT",
    category: "*",
    shopType: "MARKETPLACE",
    bxpStatus: "NON_BXP",
    rate: null,
    fixedAmount: 1.0,
    perUnit: "ORDER",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=7992113007347457",
  },
  // 平台支持费 - BXP
  {
    id: "demo-psf-bxp",
    site: "MY",
    feeType: "PLATFORM_SUPPORT",
    category: "*",
    shopType: "MARKETPLACE",
    bxpStatus: "BXP",
    rate: null,
    fixedAmount: 1.0,
    perUnit: "ORDER",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=7992113007347457",
  },
  // 平台支持费 - Mall
  {
    id: "demo-psf-mall",
    site: "MY",
    feeType: "PLATFORM_SUPPORT",
    category: "*",
    shopType: "MALL",
    bxpStatus: "NON_BXP",
    rate: null,
    fixedAmount: 1.5,
    perUnit: "ORDER",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    version: 1,
    source: "https://seller-my.tiktok.com/university/essay?knowledge_id=7992113007347457",
  },
];
