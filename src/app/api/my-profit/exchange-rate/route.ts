import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * 汇率服务 GET /api/my-profit/exchange-rate?from=MYR&to=CNY
 * 1. 尝试获取实时汇率（公开 API）
 * 2. 成功则写入数据库缓存并返回
 * 3. 失败则降级返回最近缓存值，并标注 isRealtime=false
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get("from") || "MYR").toUpperCase();
  const to = (searchParams.get("to") || "CNY").toUpperCase();

  // 1. 尝试实时获取
  try {
    const realtime = await fetchRealtimeRate(from, to);
    if (realtime && realtime > 0) {
      // 写入缓存
      await prisma.exchangeRate.create({
        data: {
          fromCurrency: from,
          toCurrency: to,
          rate: realtime,
          source: "open.er-api.com",
          isRealtime: true,
        },
      });
      return NextResponse.json({
        from,
        to,
        rate: realtime,
        isRealtime: true,
        source: "open.er-api.com",
        fetchedAt: new Date().toISOString(),
      });
    }
  } catch {
    // 实时获取失败，降级到缓存
  }

  // 2. 降级：最近缓存
  const cached = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: from, toCurrency: to },
    orderBy: { fetchedAt: "desc" },
  });

  if (cached) {
    return NextResponse.json({
      from,
      to,
      rate: Number(cached.rate),
      isRealtime: false,
      source: cached.source,
      fetchedAt: cached.fetchedAt.toISOString(),
      note: "实时汇率不可用，当前为缓存参考值",
    });
  }

  // 3. 兜底默认值
  const fallback = from === "MYR" && to === "CNY" ? 1.62 : 1;
  return NextResponse.json({
    from,
    to,
    rate: fallback,
    isRealtime: false,
    source: "fallback",
    fetchedAt: new Date().toISOString(),
    note: "无缓存数据，使用内置参考汇率",
  });
}

/** 调用公开汇率 API（免费、无需 key） */
async function fetchRealtimeRate(from: string, to: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.[to];
    return typeof rate === "number" ? rate : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
