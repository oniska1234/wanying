/**
 * MY Profit 计算引擎 - 情景分析
 * 乐观/正常/悲观三种经营情景
 */
import Decimal from "decimal.js";
import type { CalculationInput, ScenarioParams, ScenarioResult } from "./types";
import { calculate } from "./calculator";

/** 默认情景参数 */
export const DEFAULT_SCENARIOS: ScenarioParams[] = [
  {
    label: "乐观",
    adRateOverride: new Decimal("0.03"),     // 广告 3%
    refundRateOverride: new Decimal("0.02"), // 退款 2%
    affiliateRateOverride: new Decimal("0.05"), // 达人 5%
  },
  {
    label: "正常",
    // 使用用户当前输入，不覆盖
  },
  {
    label: "悲观",
    adRateOverride: new Decimal("0.15"),     // 广告 15%
    refundRateOverride: new Decimal("0.10"), // 退款 10%
    affiliateRateOverride: new Decimal("0.15"), // 达人 15%
  },
];

/**
 * 计算三种情景结果
 */
export function calculateScenarios(
  input: CalculationInput,
  scenarios?: ScenarioParams[]
): ScenarioResult[] {
  const params = scenarios || DEFAULT_SCENARIOS;

  return params.map((scenario) => {
    const modifiedInput: CalculationInput = { ...input };

    if (scenario.adRateOverride !== undefined) {
      modifiedInput.adRate = scenario.adRateOverride;
    }
    if (scenario.refundRateOverride !== undefined) {
      modifiedInput.refundRate = scenario.refundRateOverride;
    }
    if (scenario.affiliateRateOverride !== undefined) {
      modifiedInput.affiliateRate = scenario.affiliateRateOverride;
    }

    const result = calculate(modifiedInput);

    return {
      label: scenario.label,
      netProfit: result.netProfit,
      netMargin: result.netMargin,
      expectedProfit: result.expectedProfit,
    };
  });
}
