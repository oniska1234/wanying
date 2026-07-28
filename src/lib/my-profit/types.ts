/**
 * MY Profit 计算引擎 - 类型定义
 * 所有金额内部使用 Decimal（4位小数），展示时按币种舍入
 */
import Decimal from "decimal.js";

// 配置 Decimal 精度
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ============ 枚举 ============

export type ShopType = "MARKETPLACE" | "MALL";
export type BxpStatus = "BXP" | "NON_BXP" | "UNCERTAIN";
export type FeeType = "COMMISSION" | "TRANSACTION" | "PLATFORM_SUPPORT";
export type FeeUnit = "ORDER" | "ITEM" | "REVENUE";
export type CostCurrency = "CNY" | "MYR";

// ============ 费率规则 ============

export interface FeeRuleMatch {
  feeType: FeeType;
  rate: Decimal | null;       // 比例费率 (如 0.05 = 5%)
  fixedAmount: Decimal | null; // 固定金额 (MYR)
  perUnit: FeeUnit;
  version: number;
  source: string | null;
  effectiveFrom: string;
}

export interface FeeMatchResult {
  commission: FeeRuleMatch | null;
  transaction: FeeRuleMatch | null;
  platformSupport: FeeRuleMatch | null;
  /** 是否有未匹配的规则（需用户手工输入） */
  hasUnmatched: boolean;
  /** 佣金类目匹配级别：exact=精确子类目, parent=父类目, default=通用默认 */
  matchLevel: "exact" | "parent" | "default";
  /** 用户自定义覆盖 */
  overrides: Partial<Record<FeeType, { rate?: Decimal; fixedAmount?: Decimal }>>;
}

// ============ 计算输入 ============

export interface CalculationInput {
  // 基础信息
  shopType: ShopType;
  bxpStatus: BxpStatus;
  category: string;
  costCurrency: CostCurrency;

  // 收入项 (MYR)
  originalPrice: Decimal;      // 商品原价
  sellerDiscount: Decimal;     // 卖家折扣
  platformDiscount: Decimal;   // 平台折扣
  buyerShipping: Decimal;      // 买家支付运费
  otherIncome: Decimal;        // 其他收入
  quantity: number;            // 商品数量

  // 成本项（costCurrency 币种）
  purchasePrice: Decimal;      // 单件采购价
  domesticShipping: Decimal;   // 国内运输/操作费
  packagingCost: Decimal;      // 包材费
  crossBorderLogistics: Decimal; // 跨境头程
  localFulfillment: Decimal;   // 本地履约/尾程
  storageCost: Decimal;        // 仓储分摊
  otherCost: Decimal;          // 其他固定成本

  // 达人和广告
  affiliateRate: Decimal;      // 达人佣金比例 (基于到手收入)
  affiliateFixed: Decimal;     // 达人佣金固定金额 (MYR)
  adRate: Decimal;             // 广告成本比例 (基于到手收入)
  adFixed: Decimal;            // 广告固定成本 (MYR)

  // 退款
  refundRate: Decimal;         // 预估退款率 (0-1)
  refundRecovery: Decimal;     // 退款后商品可回收价值 (costCurrency)
  refundExtraCost: Decimal;    // 退款额外物流/处理成本 (costCurrency)

  // 汇率
  exchangeRate: Decimal;       // 1 MYR = exchangeRate CNY（CNY/MYR）

  // 费率（匹配结果或自定义）
  feeRules: FeeMatchResult;
}

// ============ 计算输出 ============

export interface FeeBreakdown {
  feeType: FeeType;
  label: string;
  /** 计费基数 (MYR) */
  base: Decimal;
  /** 费率或固定金额 */
  rate: Decimal | null;
  fixedAmount: Decimal | null;
  /** 计算结果 (MYR) */
  amount: Decimal;
  /** 公式说明 */
  formula: string;
  /** 费率来源 */
  source: string | null;
  version: number | null;
}

export interface CalculationResult {
  // 收入
  grossRevenue: Decimal;        // 总交易额 (原价 - 卖家折扣 + 买家运费)
  netRevenue: Decimal;          // 预计到手收入 (扣除平台费后)

  // 平台费用
  totalPlatformFees: Decimal;   // 平台总费用
  feeBreakdown: FeeBreakdown[]; // 费用明细

  // 成本 (全部换算为 MYR)
  totalCogs: Decimal;           // 商品及履约总成本
  totalAffiliateAd: Decimal;    // 达人+广告成本
  totalCost: Decimal;           // 总成本

  // 利润
  netProfit: Decimal;           // 单件净利润
  netMargin: Decimal;           // 净利率 (0-1)
  expectedProfit: Decimal;      // 期望利润（考虑退款率）

  // 关键指标
  breakEvenPrice: Decimal | null;   // 保本售价
  maxPurchasePrice: Decimal | null; // 最高可接受采购价 (costCurrency)
  suggestedPrice: Decimal | null;   // 目标净利率下建议售价

  // 退款分析
  refundLoss: Decimal;          // 单笔全额退款预计损失
  refundAdjustedProfit: Decimal; // 退款率调整后期望利润

  // 风险标记
  risks: RiskFlag[];

  // 元数据
  exchangeRateUsed: Decimal;
  feeRuleVersions: string[];
  calculatedAt: string;
}

export interface RiskFlag {
  level: "red" | "orange" | "yellow";
  message: string;
}

// ============ 情景分析 ============

export interface ScenarioParams {
  label: string;
  adRateOverride?: Decimal;
  refundRateOverride?: Decimal;
  affiliateRateOverride?: Decimal;
}

export interface ScenarioResult {
  label: string;
  netProfit: Decimal;
  netMargin: Decimal;
  expectedProfit: Decimal;
}

// ============ 辅助类型 ============

/** 将普通 number/string 转为 Decimal */
export function d(value: number | string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value || 0);
}

/** MYR 展示：保留2位小数 */
export function fmtMYR(value: Decimal): string {
  return `RM ${value.toFixed(2)}`;
}

/** 百分比展示 */
export function fmtPct(value: Decimal): string {
  return `${value.mul(100).toFixed(2)}%`;
}
