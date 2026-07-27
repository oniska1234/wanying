/**
 * MY Profit 计算引擎 - 保本售价 & 目标利润率求解器
 * 使用二分法求解，误差 <= RM0.01
 */
import Decimal from "decimal.js";
import type { CalculationInput } from "./types";

/** 精度：RM0.01 */
const PRECISION = new Decimal("0.01");
/** 最大迭代次数 */
const MAX_ITER = 100;

/**
 * 内部简化计算：给定售价，返回净利润
 * 避免循环依赖，这里内联核心逻辑
 */
function profitAtPrice(input: CalculationInput, price: Decimal): Decimal {
  const {
    sellerDiscount, platformDiscount, buyerShipping, otherIncome,
    quantity, costCurrency, exchangeRate, feeRules,
  } = input;

  // 计费基数
  const commissionBase = price.sub(sellerDiscount);
  const transactionBase = commissionBase.add(buyerShipping);

  // 平台费
  let totalFees = new Decimal(0);

  const commRule = feeRules.overrides.COMMISSION
    ? { rate: feeRules.overrides.COMMISSION.rate ?? null, fixedAmount: feeRules.overrides.COMMISSION.fixedAmount ?? null, perUnit: "REVENUE" }
    : feeRules.commission;
  if (commRule) {
    if (commRule.rate) totalFees = totalFees.add(commissionBase.mul(commRule.rate));
    if (commRule.fixedAmount) totalFees = totalFees.add(commRule.fixedAmount);
  }

  const txnRule = feeRules.overrides.TRANSACTION
    ? { rate: feeRules.overrides.TRANSACTION.rate ?? null, fixedAmount: feeRules.overrides.TRANSACTION.fixedAmount ?? null, perUnit: "REVENUE" }
    : feeRules.transaction;
  if (txnRule) {
    if (txnRule.rate) totalFees = totalFees.add(transactionBase.mul(txnRule.rate));
    if (txnRule.fixedAmount) totalFees = totalFees.add(txnRule.fixedAmount);
  }

  const psfRule = feeRules.overrides.PLATFORM_SUPPORT
    ? { rate: feeRules.overrides.PLATFORM_SUPPORT.rate ?? null, fixedAmount: feeRules.overrides.PLATFORM_SUPPORT.fixedAmount ?? null, perUnit: "ORDER" }
    : feeRules.platformSupport;
  if (psfRule) {
    if (psfRule.rate) totalFees = totalFees.add(transactionBase.mul(psfRule.rate));
    if (psfRule.fixedAmount) totalFees = totalFees.add(psfRule.fixedAmount);
  }

  // 到手收入
  const grossRevenue = price.sub(sellerDiscount).sub(platformDiscount).add(buyerShipping).add(otherIncome);
  const netRevenue = grossRevenue.sub(totalFees);

  // 成本 (转 MYR)
  const cogsLocal = [
    input.purchasePrice, input.domesticShipping, input.packagingCost,
    input.crossBorderLogistics, input.localFulfillment, input.storageCost, input.otherCost,
  ].reduce((s, v) => s.add(v), new Decimal(0));

  const totalCogs = costCurrency === "MYR" ? cogsLocal : cogsLocal.div(exchangeRate);

  // 达人 + 广告
  const affiliateAd = netRevenue.mul(input.affiliateRate).add(input.affiliateFixed)
    .add(netRevenue.mul(input.adRate)).add(input.adFixed);

  return netRevenue.sub(totalCogs).sub(affiliateAd);
}

/**
 * 二分法求解保本售价（净利润 = 0）
 * 返回 null 表示在合理区间内无解
 */
export function solveBreakEven(input: CalculationInput): Decimal | null {
  // 下界约束：售价必须 > 卖家折扣，否则佣金基数为负，业务无意义
  const minPrice = input.sellerDiscount.add(new Decimal("0.01"));
  return binarySolve(input, new Decimal(0), minPrice);
}

/**
 * 二分法求解目标净利率的售价
 * targetMargin: 目标净利率 (如 0.2 = 20%)
 */
export function solveTargetMargin(input: CalculationInput, targetMargin: Decimal): Decimal | null {
  // 净利率 = netProfit / grossRevenue = targetMargin
  // 即 netProfit = targetMargin * grossRevenue
  // 转化为求 f(price) = netProfit - targetMargin * grossRevenue = 0
  // 下界约束：售价必须 > 卖家折扣
  let lo = input.sellerDiscount.add(new Decimal("0.01"));
  let hi = input.originalPrice.mul(10).add(new Decimal(1000));

  for (let i = 0; i < MAX_ITER; i++) {
    const mid = lo.add(hi).div(2);
    const profit = profitAtPrice(input, mid);
    const gross = mid.sub(input.sellerDiscount).sub(input.platformDiscount).add(input.buyerShipping).add(input.otherIncome);
    const target = gross.mul(targetMargin);
    const diff = profit.sub(target);

    if (diff.abs().lt(PRECISION)) return mid;
    if (diff.lt(0)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return null;
}

/**
 * 通用二分求解：找到使净利润 = targetProfit 的售价
 */
function binarySolve(input: CalculationInput, targetProfit: Decimal, minPrice?: Decimal): Decimal | null {
  // 下界：至少为 minPrice（确保佣金基数 > 0）
  let lo = minPrice ?? new Decimal("0.01");
  // 上界：原价的10倍 + 1000，确保覆盖
  let hi = input.originalPrice.mul(10).add(new Decimal(1000));

  // 检查边界
  const profitAtLo = profitAtPrice(input, lo);
  const profitAtHi = profitAtPrice(input, hi);

  // 如果最低价已经盈利，保本价低于当前范围
  if (profitAtLo.gte(targetProfit)) return lo;
  // 如果最高价仍亏损，无解
  if (profitAtHi.lt(targetProfit)) return null;

  for (let i = 0; i < MAX_ITER; i++) {
    const mid = lo.add(hi).div(2);
    const profit = profitAtPrice(input, mid);
    const diff = profit.sub(targetProfit);

    if (diff.abs().lt(PRECISION)) return mid;
    if (diff.lt(0)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // 收敛后返回
  return lo.add(hi).div(2);
}
