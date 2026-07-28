/**
 * MY Profit 计算引擎 - 核心利润计算
 * 纯函数模块：输入完整快照 → 输出完整结果
 * 不依赖页面状态、数据库或外部服务
 */
import Decimal from "decimal.js";
import {
  type CalculationInput,
  type CalculationResult,
  type FeeBreakdown,
  type RiskFlag,
  d,
} from "./types";
import { solveBreakEven, solveTargetMargin } from "./solver";

/**
 * 将成本币种金额转换为 MYR
 * exchangeRate = 1 MYR 兑换多少 CNY
 * 所以 CNY → MYR: amount / exchangeRate
 */
function toMYR(amount: Decimal, currency: string, exchangeRate: Decimal): Decimal {
  if (currency === "MYR") return amount;
  return amount.div(exchangeRate);
}

/**
 * 计算单笔平台费用
 */
function calcFee(
  base: Decimal,
  rate: Decimal | null,
  fixedAmount: Decimal | null,
  perUnit: string,
  quantity: number
): Decimal {
  let amount = new Decimal(0);
  if (rate && !rate.isZero()) {
    amount = amount.add(base.mul(rate));
  }
  if (fixedAmount && !fixedAmount.isZero()) {
    // 按订单收取的费用不按件数倍增
    if (perUnit === "ORDER") {
      amount = amount.add(fixedAmount);
    } else {
      amount = amount.add(fixedAmount.mul(quantity));
    }
  }
  return amount;
}

/**
 * 主计算函数
 */
export function calculate(input: CalculationInput): CalculationResult {
  const {
    originalPrice,
    sellerDiscount,
    platformDiscount,
    buyerShipping,
    otherIncome,
    quantity,
    costCurrency,
    exchangeRate,
    feeRules,
  } = input;

  const risks: RiskFlag[] = [];
  const feeBreakdown: FeeBreakdown[] = [];
  const feeRuleVersions: string[] = [];

  // ========== 1. 计算计费基数 ==========

  // 佣金计费基数 = 商品原价 - 卖家折扣
  const commissionBase = originalPrice.sub(sellerDiscount);

  // 交易费计费基数 = 商品原价 - 卖家折扣 + 买家支付运费
  const transactionBase = commissionBase.add(buyerShipping);

  // ========== 2. 计算平台费用 ==========

  let totalPlatformFees = new Decimal(0);

  // 佣金
  const commRule = feeRules.overrides.COMMISSION
    ? { rate: feeRules.overrides.COMMISSION.rate ?? null, fixedAmount: feeRules.overrides.COMMISSION.fixedAmount ?? null, perUnit: "REVENUE" as const, version: 0, source: "用户自定义", effectiveFrom: "" }
    : feeRules.commission;

  if (commRule) {
    const commAmount = calcFee(commissionBase, commRule.rate, commRule.fixedAmount, commRule.perUnit, quantity);
    totalPlatformFees = totalPlatformFees.add(commAmount);
    feeBreakdown.push({
      feeType: "COMMISSION",
      label: "平台佣金",
      base: commissionBase,
      rate: commRule.rate,
      fixedAmount: commRule.fixedAmount,
      amount: commAmount,
      formula: commRule.rate
        ? `(${originalPrice.toFixed(2)} - ${sellerDiscount.toFixed(2)}) × ${(commRule.rate.mul(100)).toFixed(2)}%`
        : `固定 ${commRule.fixedAmount?.toFixed(2)}`,
      source: commRule.source,
      version: commRule.version || null,
    });
    if (commRule.version) feeRuleVersions.push(`COMMISSION:v${commRule.version}`);
  } else {
    risks.push({ level: "orange", message: "佣金费率未匹配，请手工输入" });
  }

  // 交易费
  const txnRule = feeRules.overrides.TRANSACTION
    ? { rate: feeRules.overrides.TRANSACTION.rate ?? null, fixedAmount: feeRules.overrides.TRANSACTION.fixedAmount ?? null, perUnit: "REVENUE" as const, version: 0, source: "用户自定义", effectiveFrom: "" }
    : feeRules.transaction;

  if (txnRule) {
    const txnAmount = calcFee(transactionBase, txnRule.rate, txnRule.fixedAmount, txnRule.perUnit, quantity);
    totalPlatformFees = totalPlatformFees.add(txnAmount);
    feeBreakdown.push({
      feeType: "TRANSACTION",
      label: "交易费",
      base: transactionBase,
      rate: txnRule.rate,
      fixedAmount: txnRule.fixedAmount,
      amount: txnAmount,
      formula: txnRule.rate
        ? `(${commissionBase.toFixed(2)} + ${buyerShipping.toFixed(2)}) × ${(txnRule.rate.mul(100)).toFixed(2)}%`
        : `固定 ${txnRule.fixedAmount?.toFixed(2)}`,
      source: txnRule.source,
      version: txnRule.version || null,
    });
    if (txnRule.version) feeRuleVersions.push(`TRANSACTION:v${txnRule.version}`);
  } else {
    risks.push({ level: "orange", message: "交易费率未匹配，请手工输入" });
  }

  // 平台支持费
  const psfRule = feeRules.overrides.PLATFORM_SUPPORT
    ? { rate: feeRules.overrides.PLATFORM_SUPPORT.rate ?? null, fixedAmount: feeRules.overrides.PLATFORM_SUPPORT.fixedAmount ?? null, perUnit: "ORDER" as const, version: 0, source: "用户自定义", effectiveFrom: "" }
    : feeRules.platformSupport;

  if (psfRule) {
    // 平台支持费按成功交付订单收取，计费基数为交易总额
    const psfBase = transactionBase;
    const psfAmount = calcFee(psfBase, psfRule.rate, psfRule.fixedAmount, psfRule.perUnit, quantity);
    totalPlatformFees = totalPlatformFees.add(psfAmount);
    feeBreakdown.push({
      feeType: "PLATFORM_SUPPORT",
      label: "平台支持费",
      base: psfBase,
      rate: psfRule.rate,
      fixedAmount: psfRule.fixedAmount,
      amount: psfAmount,
      formula: psfRule.rate
        ? `${psfBase.toFixed(2)} × ${(psfRule.rate.mul(100)).toFixed(2)}%（按订单）`
        : `${psfRule.fixedAmount?.toFixed(2)}（按订单）`,
      source: psfRule.source,
      version: psfRule.version || null,
    });
    if (psfRule.version) feeRuleVersions.push(`PLATFORM_SUPPORT:v${psfRule.version}`);
  }

  // ========== 3. 计算到手收入 ==========

  // 总交易额 = 原价 - 卖家折扣 + 买家运费 + 其他收入
  // 注意：平台折扣由平台资助，不从卖家收入中扣除
  const grossRevenue = originalPrice.sub(sellerDiscount).add(buyerShipping).add(otherIncome);

  // 预计到手收入 = 总交易额 - 平台总费用
  const netRevenue = grossRevenue.sub(totalPlatformFees);

  // ========== 4. 计算成本（全部转为 MYR） ==========

  const cogsItems = [
    input.purchasePrice,
    input.domesticShipping,
    input.packagingCost,
    input.crossBorderLogistics,
    input.localFulfillment,
    input.storageCost,
    input.otherCost,
  ];

  const totalCogsLocal = cogsItems.reduce((sum, item) => sum.add(item), new Decimal(0));
  const totalCogs = toMYR(totalCogsLocal, costCurrency, exchangeRate);

  // ========== 5. 达人和广告成本 ==========

  const affiliateCost = netRevenue.mul(input.affiliateRate).add(input.affiliateFixed);
  const adCost = netRevenue.mul(input.adRate).add(input.adFixed);
  const totalAffiliateAd = affiliateCost.add(adCost);

  // ========== 6. 总成本和净利润 ==========

  const totalCost = totalCogs.add(totalAffiliateAd);
  const netProfit = netRevenue.sub(totalCost);
  const netMargin = grossRevenue.isZero() ? new Decimal(0) : netProfit.div(grossRevenue);

  // ========== 7. 保本售价和最高采购价 ==========

  const breakEvenPrice = solveBreakEven(input);
  const maxPurchasePrice = solveMaxPurchase(input);

  // ========== 8. 退款分析 ==========

  // 单笔全额退款损失 = 已付出的成本 + 不可退还的平台费 - 可回收价值
  const refundRecoveryMYR = toMYR(input.refundRecovery, costCurrency, exchangeRate);
  const refundExtraMYR = toMYR(input.refundExtraCost, costCurrency, exchangeRate);
  // 退款后：失去到手收入，但部分成本已发生
  const refundLoss = totalCogs.add(totalAffiliateAd).add(refundExtraMYR).sub(refundRecoveryMYR);

  // 期望利润 = 正常利润 × (1-退款率) + 退款损失 × 退款率（退款损失为负）
  const refundRate = input.refundRate;
  const expectedProfit = netProfit.mul(new Decimal(1).sub(refundRate)).add(refundLoss.neg().mul(refundRate));

  // ========== 9. 风险标记 ==========

  if (netProfit.lt(0)) {
    risks.push({ level: "red", message: `净利润为负（RM ${netProfit.toFixed(2)}），当前定价亏损` });
  }
  if (netMargin.lt(new Decimal("0.1")) && netProfit.gte(0)) {
    risks.push({ level: "orange", message: `净利率低于 10%（${netMargin.mul(100).toFixed(1)}%），利润空间较小` });
  }
  if (input.bxpStatus === "UNCERTAIN") {
    risks.push({ level: "orange", message: "BXP 身份不确定，费率可能不准确，请确认实际身份" });
  }
  if (cogsItems.some((item) => item.isZero())) {
    risks.push({ level: "yellow", message: "部分成本项为 0，请确认是否遗漏" });
  }

  // ========== 10. 目标净利率建议售价（默认 20%） ==========

  const suggestedPrice = solveTargetMargin(input, new Decimal("0.2"));

  return {
    grossRevenue,
    netRevenue,
    totalPlatformFees,
    feeBreakdown,
    totalCogs,
    totalAffiliateAd,
    totalCost,
    netProfit,
    netMargin,
    expectedProfit,
    breakEvenPrice,
    maxPurchasePrice,
    suggestedPrice,
    refundLoss,
    refundAdjustedProfit: expectedProfit,
    risks,
    exchangeRateUsed: exchangeRate,
    feeRuleVersions,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * 求解最高可接受采购价
 * 即：净利润 = 0 时的采购价上限
 */
function solveMaxPurchase(input: CalculationInput): Decimal | null {
  // 先计算除采购价外的所有成本和费用
  const testInput: CalculationInput = {
    ...input,
    purchasePrice: new Decimal(0),
  };

  const resultWithoutPurchase = calculateCore(testInput);
  // 最高采购价(MYR) = 净利润（采购价为0时）
  const maxMYR = resultWithoutPurchase.netProfit;
  if (maxMYR.lte(0)) return new Decimal(0);

  // 转回成本币种
  if (input.costCurrency === "MYR") return maxMYR;
  return maxMYR.mul(input.exchangeRate); // MYR → CNY
}

/**
 * 内部核心计算（不含保本价求解，避免循环调用）
 */
function calculateCore(input: CalculationInput): Omit<CalculationResult, "breakEvenPrice" | "maxPurchasePrice" | "suggestedPrice"> {
  const {
    originalPrice, sellerDiscount, platformDiscount, buyerShipping, otherIncome,
    quantity, costCurrency, exchangeRate, feeRules,
  } = input;

  const commissionBase = originalPrice.sub(sellerDiscount);
  const transactionBase = commissionBase.add(buyerShipping);

  let totalPlatformFees = new Decimal(0);
  const feeBreakdown: FeeBreakdown[] = [];
  const feeRuleVersions: string[] = [];
  const risks: RiskFlag[] = [];

  // 平台费计算（简化版）
  const rules = [
    { key: "COMMISSION" as const, rule: feeRules.overrides.COMMISSION ? { rate: feeRules.overrides.COMMISSION.rate ?? null, fixedAmount: feeRules.overrides.COMMISSION.fixedAmount ?? null, perUnit: "REVENUE" as const, version: 0, source: "自定义", effectiveFrom: "" } : feeRules.commission, base: commissionBase, label: "平台佣金" },
    { key: "TRANSACTION" as const, rule: feeRules.overrides.TRANSACTION ? { rate: feeRules.overrides.TRANSACTION.rate ?? null, fixedAmount: feeRules.overrides.TRANSACTION.fixedAmount ?? null, perUnit: "REVENUE" as const, version: 0, source: "自定义", effectiveFrom: "" } : feeRules.transaction, base: transactionBase, label: "交易费" },
    { key: "PLATFORM_SUPPORT" as const, rule: feeRules.overrides.PLATFORM_SUPPORT ? { rate: feeRules.overrides.PLATFORM_SUPPORT.rate ?? null, fixedAmount: feeRules.overrides.PLATFORM_SUPPORT.fixedAmount ?? null, perUnit: "ORDER" as const, version: 0, source: "自定义", effectiveFrom: "" } : feeRules.platformSupport, base: transactionBase, label: "平台支持费" },
  ];

  for (const { key, rule, base, label } of rules) {
    if (rule) {
      const amount = calcFee(base, rule.rate, rule.fixedAmount, rule.perUnit, quantity);
      totalPlatformFees = totalPlatformFees.add(amount);
      feeBreakdown.push({ feeType: key, label, base, rate: rule.rate, fixedAmount: rule.fixedAmount, amount, formula: "", source: rule.source, version: rule.version || null });
    }
  }

  // 平台折扣由平台资助，不从卖家收入中扣除
  const grossRevenue = originalPrice.sub(sellerDiscount).add(buyerShipping).add(otherIncome);
  const netRevenue = grossRevenue.sub(totalPlatformFees);

  const cogsItems = [input.purchasePrice, input.domesticShipping, input.packagingCost, input.crossBorderLogistics, input.localFulfillment, input.storageCost, input.otherCost];
  const totalCogsLocal = cogsItems.reduce((s, i) => s.add(i), new Decimal(0));
  const totalCogs = toMYR(totalCogsLocal, costCurrency, exchangeRate);

  const affiliateCost = netRevenue.mul(input.affiliateRate).add(input.affiliateFixed);
  const adCost = netRevenue.mul(input.adRate).add(input.adFixed);
  const totalAffiliateAd = affiliateCost.add(adCost);
  const totalCost = totalCogs.add(totalAffiliateAd);
  const netProfit = netRevenue.sub(totalCost);
  const netMargin = grossRevenue.isZero() ? new Decimal(0) : netProfit.div(grossRevenue);

  const refundRecoveryMYR = toMYR(input.refundRecovery, costCurrency, exchangeRate);
  const refundExtraMYR = toMYR(input.refundExtraCost, costCurrency, exchangeRate);
  const refundLoss = totalCogs.add(totalAffiliateAd).add(refundExtraMYR).sub(refundRecoveryMYR);
  const expectedProfit = netProfit.mul(new Decimal(1).sub(input.refundRate)).add(refundLoss.neg().mul(input.refundRate));

  return {
    grossRevenue, netRevenue, totalPlatformFees, feeBreakdown,
    totalCogs, totalAffiliateAd, totalCost,
    netProfit, netMargin, expectedProfit,
    refundLoss, refundAdjustedProfit: expectedProfit,
    risks, exchangeRateUsed: exchangeRate, feeRuleVersions,
    calculatedAt: new Date().toISOString(),
  };
}
