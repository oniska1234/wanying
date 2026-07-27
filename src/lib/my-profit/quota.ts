import prisma from "@/lib/prisma";

/** 免费版额度配置 */
export const FREE_LIMITS = {
  maxProducts: 10, // 最多保存商品数
  maxCalcPerDay: 10, // 每日新计算次数
  canExport: false, // 批量导出
  canScenario: false, // 高级情景分析
};

export type Plan = "FREE" | "PRO";

/** 获取用户当前生效的套餐 */
export async function getPlan(userId: string): Promise<Plan> {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) return "FREE";
  if (sub.plan === "PRO") {
    // 过期判断
    if (sub.expiresAt && sub.expiresAt.getTime() < Date.now()) return "FREE";
    return "PRO";
  }
  return "FREE";
}

export interface SaveQuota {
  plan: Plan;
  productCount: number;
  maxProducts: number | null; // null = 无限
  canSave: boolean;
  canExport: boolean;
  canScenario: boolean;
}

/** 选品保存额度检查 */
export async function checkQuota(userId: string): Promise<SaveQuota> {
  const plan = await getPlan(userId);
  const productCount = await prisma.product.count({ where: { userId } });
  if (plan === "PRO") {
    return {
      plan,
      productCount,
      maxProducts: null,
      canSave: true,
      canExport: true,
      canScenario: true,
    };
  }
  return {
    plan,
    productCount,
    maxProducts: FREE_LIMITS.maxProducts,
    canSave: productCount < FREE_LIMITS.maxProducts,
    canExport: FREE_LIMITS.canExport,
    canScenario: FREE_LIMITS.canScenario,
  };
}

export interface CalcQuota {
  plan: Plan;
  usedToday: number;
  maxPerDay: number | null; // null = 无限
  canCalc: boolean;
}

/** 每日计算额度检查（免费版每日 N 次） */
export async function checkCalcQuota(userId: string): Promise<CalcQuota> {
  const plan = await getPlan(userId);
  if (plan === "PRO") {
    return { plan, usedToday: 0, maxPerDay: null, canCalc: true };
  }
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const usedToday = await prisma.calculation.count({
    where: {
      sku: { product: { userId } },
      createdAt: { gte: startOfDay },
    },
  });
  return {
    plan,
    usedToday,
    maxPerDay: FREE_LIMITS.maxCalcPerDay,
    canCalc: usedToday < FREE_LIMITS.maxCalcPerDay,
  };
}
