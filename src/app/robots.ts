// ============================================================
// 万应 · robots.txt（Next.js MetadataRoute）
// ------------------------------------------------------------
// 放行所有搜索引擎爬虫（含 Baiduspider / 360Spider /
// Sogou web spider / YisouSpider 等），屏蔽 API 路由，
// 并声明 sitemap 位置以加速收录。
// ============================================================

import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const url = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${url}/sitemap.xml`,
    host: url,
  };
}
