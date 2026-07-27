// ============================================================
// 万应 · 站点级 SEO 配置（单一数据源）
// ------------------------------------------------------------
// sitemap / robots / metadata / JSON-LD 共用此处定义，
// 避免站点名、描述、域名散落各处导致不一致。
// 正式域名通过环境变量 NEXT_PUBLIC_SITE_URL 注入（部署前设置）。
// ============================================================

export const SITE_NAME = "万应";

export const SITE_NAME_FULL = "万应 · 万事有应的在线工具箱";

export const SITE_DESCRIPTION =
  "万应是一个免费、无需注册的在线工具站：JSON 格式化、Base64、URL 编解码、时间戳转换、二维码、密码生成、Markdown 预览、报价对比等高频小工具，打开即用，数据不出浏览器。";

export const SITE_LOCALE = "zh_CN";

/**
 * 站点正式域名（含协议，不含结尾斜杠）。
 * 部署前请设置环境变量 NEXT_PUBLIC_SITE_URL，例如 https://www.wanying.tools。
 * 未设置时使用占位域名（仅用于本地开发，切勿用于正式收录）。
 */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL || "https://wanying.example.com";
  return raw.replace(/\/+$/, "");
}
