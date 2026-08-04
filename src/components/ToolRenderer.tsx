"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const map: Record<string, ComponentType> = {
  "json-format": dynamic(() => import("./tools/JsonFormat")),
  base64: dynamic(() => import("./tools/Base64")),
  "url-codec": dynamic(() => import("./tools/UrlCodec")),
  timestamp: dynamic(() => import("./tools/Timestamp")),
  color: dynamic(() => import("./tools/ColorTool")),
  "number-base": dynamic(() => import("./tools/NumberBase")),
  counter: dynamic(() => import("./tools/Counter")),
  "case-convert": dynamic(() => import("./tools/CaseConvert")),
  markdown: dynamic(() => import("./tools/Markdown")),
  "line-tools": dynamic(() => import("./tools/LineTools")),
  qrcode: dynamic(() => import("./tools/QrTool")),
  password: dynamic(() => import("./tools/Password")),
  uuid: dynamic(() => import("./tools/Uuid")),
  random: dynamic(() => import("./tools/Random")),
  "img-base64": dynamic(() => import("./tools/ImgBase64")),
  "quote-compare": dynamic(() => import("./tools/QuoteCompare")),
  "my-profit": dynamic(() => import("./my-profit/MyProfit")),
  "image-translate": dynamic(() => import("./image-translate/ImageTranslate")),
  "image-translate-high-concurrency": dynamic(() => import("./image-translate/ImageTranslateHighConcurrency")),
};

export default function ToolRenderer({ slug }: { slug: string }) {
  const C = map[slug];
  if (!C) return null;
  return <C />;
}
