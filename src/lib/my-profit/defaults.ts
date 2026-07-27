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
