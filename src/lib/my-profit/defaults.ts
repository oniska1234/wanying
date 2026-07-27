/**
 * MY Profit - 默认输入与构造辅助
 * 供前端表单与单元测试共享
 */
import Decimal from "decimal.js";
import type { CalculationInput, ShopType, BxpStatus, CostCurrency } from "./types";
import { matchFeeRules, DEMO_FEE_RULES, type RawFeeRule } from "./fee-engine";
import { d } from "./types";

/** 表单使用的原始数值输入（number，便于受控组件） */
export interface ProfitFormValues {
  shopType: ShopType;
  bxpStatus: BxpStatus;
  category: string;
  costCurrency: CostCurrency;

  originalPrice: number;
  sellerDiscount: number;
  platformDiscount: number;
  buyerShipping: number;
  otherIncome: number;
  quantity: number;

  purchasePrice: number;
  domesticShipping: number;
  packagingCost: number;
  crossBorderLogistics: number;
  localFulfillment: number;
  storageCost: number;
  otherCost: number;

  affiliateRate: number; // 百分比，如 10 表示 10%
  affiliateFixed: number;
  adRate: number; // 百分比
  adFixed: number;

  refundRate: number; // 百分比
  refundRecovery: number;
  refundExtraCost: number;

  exchangeRate: number; // 1 MYR = exchangeRate CNY
}

/** 合理默认值：一个典型的马来站小商品 */
export const DEFAULT_FORM: ProfitFormValues = {
  shopType: "MARKETPLACE",
  bxpStatus: "NON_BXP",
  category: "",
  costCurrency: "CNY",

  originalPrice: 59.9,
  sellerDiscount: 10,
  platformDiscount: 0,
  buyerShipping: 0,
  otherIncome: 0,
  quantity: 1,

  purchasePrice: 25,
  domesticShipping: 3,
  packagingCost: 2,
  crossBorderLogistics: 8,
  localFulfillment: 0,
  storageCost: 1,
  otherCost: 0,

  affiliateRate: 10,
  affiliateFixed: 0,
  adRate: 8,
  adFixed: 0,

  refundRate: 3,
  refundRecovery: 0,
  refundExtraCost: 5,

  exchangeRate: 1.62,
};

/** 百分比 → 比例 Decimal */
function pct(v: number): Decimal {
  return d(v).div(100);
}

// ============ 输入校验 ============

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * 校验表单输入合法性。
 * 返回空数组表示通过；否则返回错误列表。
 * 前端和 API 层共用此函数。
 */
export function validateForm(form: ProfitFormValues): ValidationError[] {
  const errors: ValidationError[] = [];

  if (form.originalPrice <= 0) errors.push({ field: "originalPrice", message: "商品原价必须大于 0" });
  if (form.sellerDiscount < 0) errors.push({ field: "sellerDiscount", message: "卖家折扣不能为负数" });
  if (form.sellerDiscount > form.originalPrice && form.originalPrice > 0) {
    errors.push({ field: "sellerDiscount", message: "卖家折扣不能大于商品原价" });
  }
  if (form.platformDiscount < 0) errors.push({ field: "platformDiscount", message: "平台折扣不能为负数" });
  if (form.buyerShipping < 0) errors.push({ field: "buyerShipping", message: "买家运费不能为负数" });
  if (form.otherIncome < 0) errors.push({ field: "otherIncome", message: "其他收入不能为负数" });
  if (!Number.isInteger(form.quantity) || form.quantity < 1) {
    errors.push({ field: "quantity", message: "商品数量必须为正整数" });
  }

  // 成本项 >= 0
  const costFields: (keyof ProfitFormValues)[] = [
    "purchasePrice", "domesticShipping", "packagingCost",
    "crossBorderLogistics", "localFulfillment", "storageCost", "otherCost",
  ];
  for (const f of costFields) {
    if ((form[f] as number) < 0) errors.push({ field: f, message: `${f} 不能为负数` });
  }

  // 比例 0-100
  if (form.affiliateRate < 0 || form.affiliateRate > 100) errors.push({ field: "affiliateRate", message: "达人佣金比例须在 0-100%" });
  if (form.adRate < 0 || form.adRate > 100) errors.push({ field: "adRate", message: "广告成本比例须在 0-100%" });
  if (form.refundRate < 0 || form.refundRate > 100) errors.push({ field: "refundRate", message: "退款率须在 0-100%" });

  // 汇率 > 0
  if (form.exchangeRate <= 0) errors.push({ field: "exchangeRate", message: "汇率必须大于 0" });

  // 退款相关 >= 0
  if (form.refundRecovery < 0) errors.push({ field: "refundRecovery", message: "退款回收价值不能为负" });
  if (form.refundExtraCost < 0) errors.push({ field: "refundExtraCost", message: "退款额外成本不能为负" });

  // 达人/广告固定 >= 0
  if (form.affiliateFixed < 0) errors.push({ field: "affiliateFixed", message: "达人佣金固定不能为负" });
  if (form.adFixed < 0) errors.push({ field: "adFixed", message: "广告固定成本不能为负" });

  return errors;
}

/**
 * 将表单值构造为计算引擎输入
 * @param rules 费率规则（默认使用内置演示规则）
 */
export function buildInput(
  form: ProfitFormValues,
  rules: RawFeeRule[] = DEMO_FEE_RULES,
  date: Date = new Date()
): CalculationInput {
  const feeRules = matchFeeRules(
    rules,
    "MY",
    form.category,
    form.shopType,
    form.bxpStatus,
    date
  );

  return {
    shopType: form.shopType,
    bxpStatus: form.bxpStatus,
    category: form.category,
    costCurrency: form.costCurrency,

    originalPrice: d(form.originalPrice),
    sellerDiscount: d(form.sellerDiscount),
    platformDiscount: d(form.platformDiscount),
    buyerShipping: d(form.buyerShipping),
    otherIncome: d(form.otherIncome),
    quantity: form.quantity || 1,

    purchasePrice: d(form.purchasePrice),
    domesticShipping: d(form.domesticShipping),
    packagingCost: d(form.packagingCost),
    crossBorderLogistics: d(form.crossBorderLogistics),
    localFulfillment: d(form.localFulfillment),
    storageCost: d(form.storageCost),
    otherCost: d(form.otherCost),

    affiliateRate: pct(form.affiliateRate),
    affiliateFixed: d(form.affiliateFixed),
    adRate: pct(form.adRate),
    adFixed: d(form.adFixed),

    refundRate: pct(form.refundRate),
    refundRecovery: d(form.refundRecovery),
    refundExtraCost: d(form.refundExtraCost),

    exchangeRate: d(form.exchangeRate),
    feeRules,
  };
}
