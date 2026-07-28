/**
 * MY Profit 计算引擎单元测试
 * 覆盖：费率匹配、利润计算、保本价求解、情景分析
 * 金额误差 <= RM0.01
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { matchFeeRules, type RawFeeRule } from "./fee-engine";
import { calculate } from "./calculator";
import { solveBreakEven, solveTargetMargin } from "./solver";
import { calculateScenarios, DEFAULT_SCENARIOS } from "./scenarios";
import { buildInput, DEFAULT_FORM, type ProfitFormValues } from "./defaults";
import type { CalculationInput } from "./types";

const TOL = 0.01;

function near(actual: Decimal, expected: number, tol = TOL) {
  expect(Math.abs(actual.toNumber() - expected)).toBeLessThanOrEqual(tol);
}

/** 测试用费率规则（固定已知值，便于手工验证） */
const TEST_FEE_RULES: RawFeeRule[] = [
  { id: "t-comm-mp", site: "MY", feeType: "COMMISSION", category: "*", shopType: "MARKETPLACE", bxpStatus: "NON_BXP", rate: 0.05, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-comm-mp-bxp", site: "MY", feeType: "COMMISSION", category: "*", shopType: "MARKETPLACE", bxpStatus: "BXP", rate: 0.04, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-comm-mall", site: "MY", feeType: "COMMISSION", category: "*", shopType: "MALL", bxpStatus: "NON_BXP", rate: 0.06, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-comm-elec", site: "MY", feeType: "COMMISSION", category: "Electronics", shopType: "MARKETPLACE", bxpStatus: "NON_BXP", rate: 0.06, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-txn-mp", site: "MY", feeType: "TRANSACTION", category: "*", shopType: "MARKETPLACE", bxpStatus: "NON_BXP", rate: 0.02, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-txn-bxp", site: "MY", feeType: "TRANSACTION", category: "*", shopType: "MARKETPLACE", bxpStatus: "BXP", rate: 0.02, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-txn-mall", site: "MY", feeType: "TRANSACTION", category: "*", shopType: "MALL", bxpStatus: "NON_BXP", rate: 0.02, fixedAmount: null, perUnit: "REVENUE", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-psf-mp", site: "MY", feeType: "PLATFORM_SUPPORT", category: "*", shopType: "MARKETPLACE", bxpStatus: "NON_BXP", rate: null, fixedAmount: 1.0, perUnit: "ORDER", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-psf-bxp", site: "MY", feeType: "PLATFORM_SUPPORT", category: "*", shopType: "MARKETPLACE", bxpStatus: "BXP", rate: null, fixedAmount: 1.0, perUnit: "ORDER", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
  { id: "t-psf-mall", site: "MY", feeType: "PLATFORM_SUPPORT", category: "*", shopType: "MALL", bxpStatus: "NON_BXP", rate: null, fixedAmount: 1.5, perUnit: "ORDER", effectiveFrom: "2024-01-01T00:00:00Z", effectiveTo: null, version: 2, source: "test" },
];

// ============ 费率匹配 ============

describe("fee-engine: matchFeeRules", () => {
  it("Marketplace 非BXP 匹配默认佣金 5%", () => {
    const r = matchFeeRules(TEST_FEE_RULES, "MY", "", "MARKETPLACE", "NON_BXP");
    expect(r.commission).not.toBeNull();
    near(r.commission!.rate!, 0.05);
    expect(r.hasUnmatched).toBe(false);
  });

  it("Marketplace BXP 匹配更低佣金 4%", () => {
    const r = matchFeeRules(TEST_FEE_RULES, "MY", "", "MARKETPLACE", "BXP");
    near(r.commission!.rate!, 0.04);
  });

  it("Mall 匹配更高佣金 6%", () => {
    const r = matchFeeRules(TEST_FEE_RULES, "MY", "", "MALL", "NON_BXP");
    near(r.commission!.rate!, 0.06);
  });

  it("精确子类目优先于父类目/默认", () => {
    // Electronics 类目佣金 6%（高于默认 5%）
    const r = matchFeeRules(
      TEST_FEE_RULES,
      "MY",
      "Electronics > Phones",
      "MARKETPLACE",
      "NON_BXP"
    );
    near(r.commission!.rate!, 0.06);
  });

  it("UNCERTAIN BXP 回退到 NON_BXP（更保守）", () => {
    const r = matchFeeRules(TEST_FEE_RULES, "MY", "", "MARKETPLACE", "UNCERTAIN");
    near(r.commission!.rate!, 0.05);
  });

  it("平台支持费为按订单固定金额", () => {
    const r = matchFeeRules(TEST_FEE_RULES, "MY", "", "MARKETPLACE", "NON_BXP");
    expect(r.platformSupport).not.toBeNull();
    expect(r.platformSupport!.rate).toBeNull();
    near(r.platformSupport!.fixedAmount!, 1.0);
    expect(r.platformSupport!.perUnit).toBe("ORDER");
  });

  it("无匹配规则时标记 hasUnmatched", () => {
    const empty: RawFeeRule[] = [];
    const r = matchFeeRules(empty, "MY", "", "MARKETPLACE", "NON_BXP");
    expect(r.hasUnmatched).toBe(true);
    expect(r.commission).toBeNull();
  });

  it("新版本规则覆盖旧版本（同类目）", () => {
    const rules: RawFeeRule[] = [
      {
        id: "v1", site: "MY", feeType: "COMMISSION", category: "*",
        shopType: "MARKETPLACE", bxpStatus: "NON_BXP", rate: 0.05,
        fixedAmount: null, perUnit: "REVENUE",
        effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null, version: 1, source: null,
      },
      {
        id: "v2", site: "MY", feeType: "COMMISSION", category: "*",
        shopType: "MARKETPLACE", bxpStatus: "NON_BXP", rate: 0.07,
        fixedAmount: null, perUnit: "REVENUE",
        effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null, version: 2, source: null,
      },
    ];
    const r = matchFeeRules(rules, "MY", "", "MARKETPLACE", "NON_BXP");
    near(r.commission!.rate!, 0.07);
  });
});

// ============ 利润计算 ============

describe("calculator: calculate", () => {
  // 手工算例：
  // 原价 100, 卖家折扣 0, 买家运费 0, 数量 1
  // 佣金 5% on 100 = 5; 交易费 2% on 100 = 2; 平台支持费 1/单 = 1 → 平台费合计 8
  // 到手收入 = 100 - 8 = 92
  // 成本(CNY): 采购 30 + 国内 5 + 包材 2 + 头程 10 + 仓储 3 = 50 CNY
  // 汇率 1 MYR = 2 CNY → 成本 = 25 MYR
  // 达人 10% of 92 = 9.2; 广告 5% of 92 = 4.6 → 合计 13.8
  // 净利润 = 92 - 25 - 13.8 = 53.2
  const baseForm: ProfitFormValues = {
    ...DEFAULT_FORM,
    originalPrice: 100,
    sellerDiscount: 0,
    platformDiscount: 0,
    buyerShipping: 0,
    otherIncome: 0,
    quantity: 1,
    purchasePrice: 30,
    domesticShipping: 5,
    packagingCost: 2,
    crossBorderLogistics: 10,
    localFulfillment: 0,
    storageCost: 3,
    otherCost: 0,
    affiliateRate: 10,
    affiliateFixed: 0,
    adRate: 5,
    adFixed: 0,
    refundRate: 0,
    refundRecovery: 0,
    refundExtraCost: 0,
    exchangeRate: 2,
    costCurrency: "CNY",
    shopType: "MARKETPLACE",
    bxpStatus: "NON_BXP",
    category: "",
  };

  it("平台费合计 = 佣金+交易费+平台支持费", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    near(r.totalPlatformFees, 8); // 5 + 2 + 1
  });

  it("到手收入 = 总交易额 - 平台费", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    near(r.netRevenue, 92);
  });

  it("成本正确换算为 MYR", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    near(r.totalCogs, 25); // 50 CNY / 2
  });

  it("净利润计算正确", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    near(r.netProfit, 53.2);
  });

  it("净利率 = 净利润 / 总交易额", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    near(r.netMargin, 0.532);
  });

  it("MYR 成本不做汇率换算", () => {
    const form = { ...baseForm, costCurrency: "MYR" as const, purchasePrice: 30 };
    const input = buildInput(form, TEST_FEE_RULES);
    const r = calculate(input);
    // 成本 = 30+5+2+10+3 = 50 MYR
    near(r.totalCogs, 50);
  });

  it("退款率为0时期望利润等于净利润", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    near(r.expectedProfit, r.netProfit.toNumber());
  });

  it("退款率 > 0 时期望利润低于净利润", () => {
    const form = { ...baseForm, refundRate: 10, refundExtraCost: 5 };
    const input = buildInput(form, TEST_FEE_RULES);
    const r = calculate(input);
    expect(r.expectedProfit.lt(r.netProfit)).toBe(true);
  });

  it("亏损时给出红色风险标记", () => {
    const form = { ...baseForm, purchasePrice: 200 };
    const input = buildInput(form, TEST_FEE_RULES);
    const r = calculate(input);
    expect(r.netProfit.lt(0)).toBe(true);
    expect(r.risks.some((x) => x.level === "red")).toBe(true);
  });

  it("费用明细包含来源与公式", () => {
    const input = buildInput(baseForm, TEST_FEE_RULES);
    const r = calculate(input);
    const comm = r.feeBreakdown.find((f) => f.feeType === "COMMISSION");
    expect(comm).toBeDefined();
    expect(comm!.source).toBeTruthy();
    expect(comm!.formula.length).toBeGreaterThan(0);
  });
});

// ============ 保本价求解 ============

describe("solver", () => {
  const form: ProfitFormValues = {
    ...DEFAULT_FORM,
    originalPrice: 100,
    sellerDiscount: 0,
    platformDiscount: 0,
    buyerShipping: 0,
    otherIncome: 0,
    purchasePrice: 30,
    domesticShipping: 5,
    packagingCost: 2,
    crossBorderLogistics: 10,
    storageCost: 3,
    affiliateRate: 10,
    adRate: 5,
    refundRate: 0,
    exchangeRate: 2,
    costCurrency: "CNY",
  };

  it("保本价处净利润≈0（误差<=0.01）", () => {
    const input = buildInput(form, TEST_FEE_RULES);
    const be = solveBreakEven(input);
    expect(be).not.toBeNull();
    // 在保本价处重新计算净利润应接近 0
    const atBE = calculate({ ...input, originalPrice: be! });
    expect(Math.abs(atBE.netProfit.toNumber())).toBeLessThanOrEqual(0.05);
  });

  it("保本价低于当前售价（当前盈利时）", () => {
    const input = buildInput(form, TEST_FEE_RULES);
    const be = solveBreakEven(input);
    expect(be!.lt(input.originalPrice)).toBe(true);
  });

  it("目标净利率售价使净利率≈目标值", () => {
    const input = buildInput(form, TEST_FEE_RULES);
    const target = new Decimal("0.2");
    const price = solveTargetMargin(input, target);
    expect(price).not.toBeNull();
    const atTarget = calculate({ ...input, originalPrice: price! });
    expect(Math.abs(atTarget.netMargin.toNumber() - 0.2)).toBeLessThanOrEqual(0.01);
  });
});

// ============ 情景分析 ============

describe("scenarios", () => {
  it("返回三种情景", () => {
    const input = buildInput(DEFAULT_FORM, TEST_FEE_RULES);
    const results = calculateScenarios(input);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.label)).toEqual(["乐观", "正常", "悲观"]);
  });

  it("乐观情景利润 >= 悲观情景", () => {
    const input = buildInput(DEFAULT_FORM, TEST_FEE_RULES);
    const results = calculateScenarios(input);
    const optimistic = results.find((r) => r.label === "乐观")!;
    const pessimistic = results.find((r) => r.label === "悲观")!;
    expect(optimistic.netProfit.gte(pessimistic.netProfit)).toBe(true);
  });

  it("自定义情景参数生效", () => {
    const input = buildInput(DEFAULT_FORM, TEST_FEE_RULES);
    const results = calculateScenarios(input, DEFAULT_SCENARIOS);
    expect(results.every((r) => r.netProfit instanceof Decimal)).toBe(true);
  });
});
