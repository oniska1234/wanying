// ============================================================
// 万应 · sitemap.xml（Next.js MetadataRoute）
// ------------------------------------------------------------
// 列出首页与全部工具页（/tools/[slug]），供百度 / 360 / 搜狗 /
// 神马 / 头条等搜索引擎批量收录。
// 注意：报价齐的规范地址为 /tools/quote-compare，/quote-compare
//       会 301 重定向到该地址，故不在此重复列出，避免重复内容。
// ============================================================

import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools";
import { getSiteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = getSiteUrl();
  const now = new Date();

  const routes: MetadataRoute.Sitemap = [
    {
      url: `${url}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  for (const t of tools) {
    routes.push({
      url: `${url}/tools/${t.slug}`,
      lastModified: now,
      changeFrequency: "monthly",
      // 热门工具优先级更高
      priority: t.hot ? 0.9 : 0.7,
    });
  }

  return routes;
}
