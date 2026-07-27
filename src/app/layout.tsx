import type { Metadata } from "next";
import { Archivo_Black, Noto_Sans_SC, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Providers from "@/components/Providers";
import {
  SITE_NAME,
  SITE_NAME_FULL,
  SITE_DESCRIPTION,
  SITE_LOCALE,
  getSiteUrl,
} from "@/lib/site";

const archivo = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const noto = Noto_Sans_SC({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-noto",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: SITE_NAME_FULL,
    template: "%s · 万应",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "在线工具",
    "JSON格式化",
    "Base64",
    "时间戳转换",
    "二维码生成",
    "密码生成器",
    "Markdown预览",
    "报价对比",
    "工具箱",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME_FULL,
    description: SITE_DESCRIPTION,
    locale: SITE_LOCALE,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: SITE_NAME_FULL,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    // 百度移动适配：声明页面同时适配 PC 与移动端
    "applicable-device": "pc,mobile",
    "MobileOptimized": "width",
    "HandheldFriendly": "true",
  },
};

/** 站点级 JSON-LD（WebSite + Organization） */
function SiteJsonLd() {
  const url = getSiteUrl();
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        url,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "zh-CN",
        publisher: { "@id": `${url}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${url}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${url}/#org`,
        name: SITE_NAME,
        url,
        description: SITE_DESCRIPTION,
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${archivo.variable} ${noto.variable} ${jetbrains.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-paper text-ink">
        <Providers>
          <SiteJsonLd />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
