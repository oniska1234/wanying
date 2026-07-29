import {
  Braces,
  Binary,
  Link2,
  TimerReset,
  Palette,
  Hash,
  AlignLeft,
  CaseSensitive,
  FileText,
  ListOrdered,
  QrCode,
  KeyRound,
  Fingerprint,
  Dices,
  Image as ImageIcon,
  FileSearch,
  TrendingUp,
  Languages,
  type LucideIcon,
} from "lucide-react";

export type CategoryId = "encode" | "text" | "generate" | "media" | "business" | "cross-border";

export interface Category {
  id: CategoryId;
  name: string;
  en: string;
  tagline: string;
  /** tailwind text color class */
  text: string;
  /** tailwind bg color class */
  bg: string;
  /** soft bg */
  soft: string;
  /** raw hex for inline use */
  hex: string;
}

export interface Tool {
  slug: string;
  name: string;
  en: string;
  desc: string;
  category: CategoryId;
  icon: LucideIcon;
  keywords: string[];
  hot?: boolean;
  isNew?: boolean;
}

export const categories: Category[] = [
  {
    id: "encode",
    name: "编码转换",
    en: "Encode",
    tagline: "格式化、编解码、进制与颜色",
    text: "text-cat-encode",
    bg: "bg-cat-encode",
    soft: "bg-cat-encode/10",
    hex: "#2457e6",
  },
  {
    id: "text",
    name: "文本办公",
    en: "Text",
    tagline: "统计、转换与排版整理",
    text: "text-cat-text",
    bg: "bg-cat-text",
    soft: "bg-cat-text/10",
    hex: "#0c8f5f",
  },
  {
    id: "generate",
    name: "生成计算",
    en: "Generate",
    tagline: "二维码、密码、唯一标识与随机",
    text: "text-cat-generate",
    bg: "bg-cat-generate",
    soft: "bg-cat-generate/10",
    hex: "#e07b0c",
  },
  {
    id: "media",
    name: "图形图像",
    en: "Media",
    tagline: "图片处理与转换",
    text: "text-cat-media",
    bg: "bg-cat-media",
    soft: "bg-cat-media/10",
    hex: "#d23f8e",
  },
  {
    id: "business",
    name: "商务办公",
    en: "Business",
    tagline: "报价对比、文档分析与商业工具",
    text: "text-[#3b5bdb]",
    bg: "bg-[#3b5bdb]",
    soft: "bg-[#3b5bdb]/10",
    hex: "#3b5bdb",
  },
  {
    id: "cross-border",
    name: "跨境工具",
    en: "Cross-Border",
    tagline: "跨境电商利润测算、选品与费率分析",
    text: "text-[#0ca678]",
    bg: "bg-[#0ca678]",
    soft: "bg-[#0ca678]/10",
    hex: "#0ca678",
  },
];

export const tools: Tool[] = [
  // ---- encode ----
  {
    slug: "json-format",
    name: "JSON 格式化",
    en: "JSON Formatter",
    desc: "格式化、压缩与校验 JSON，错误定位一目了然。",
    category: "encode",
    icon: Braces,
    keywords: ["json", "格式化", "校验", "压缩", "美化"],
    hot: true,
  },
  {
    slug: "base64",
    name: "Base64 编解码",
    en: "Base64",
    desc: "文本与 Base64 互转，支持中文与 UTF-8。",
    category: "encode",
    icon: Binary,
    keywords: ["base64", "编码", "解码", "utf-8"],
  },
  {
    slug: "url-codec",
    name: "URL 编解码",
    en: "URL Encode",
    desc: "encodeURIComponent / decode 一键转换。",
    category: "encode",
    icon: Link2,
    keywords: ["url", "编码", "解码", "encode", "转义"],
  },
  {
    slug: "timestamp",
    name: "时间戳转换",
    en: "Timestamp",
    desc: "Unix 时间戳与北京时间互转，支持秒/毫秒。",
    category: "encode",
    icon: TimerReset,
    keywords: ["时间戳", "timestamp", "unix", "日期", "时间"],
    hot: true,
  },
  {
    slug: "color",
    name: "颜色转换",
    en: "Color",
    desc: "HEX / RGB / HSL 互转，取色与预览。",
    category: "encode",
    icon: Palette,
    keywords: ["颜色", "color", "hex", "rgb", "hsl", "取色"],
  },
  {
    slug: "number-base",
    name: "进制转换",
    en: "Number Base",
    desc: "二、八、十、十六进制实时互转。",
    category: "encode",
    icon: Hash,
    keywords: ["进制", "二进制", "十六进制", "转换", "hex"],
  },
  // ---- text ----
  {
    slug: "counter",
    name: "字数统计",
    en: "Word Counter",
    desc: "统计字符、字数、词数、行数与阅读时长。",
    category: "text",
    icon: AlignLeft,
    keywords: ["字数", "字符", "统计", "词数", "行数"],
  },
  {
    slug: "case-convert",
    name: "大小写转换",
    en: "Case Convert",
    desc: "全大写、全小写、首字母大写与驼峰命名。",
    category: "text",
    icon: CaseSensitive,
    keywords: ["大小写", "驼峰", "命名", "转换", "case"],
  },
  {
    slug: "markdown",
    name: "Markdown 预览",
    en: "Markdown",
    desc: "左侧书写，右侧实时渲染，支持表格与代码块。",
    category: "text",
    icon: FileText,
    keywords: ["markdown", "md", "预览", "渲染", "编辑器"],
    hot: true,
  },
  {
    slug: "line-tools",
    name: "文本行处理",
    en: "Line Tools",
    desc: "去重、排序、去空行、加序号，批量整理文本。",
    category: "text",
    icon: ListOrdered,
    keywords: ["去重", "排序", "去空行", "文本", "行"],
  },
  // ---- generate ----
  {
    slug: "qrcode",
    name: "二维码生成",
    en: "QR Code",
    desc: "输入文本或网址生成二维码，可下载 PNG。",
    category: "generate",
    icon: QrCode,
    keywords: ["二维码", "qrcode", "生成", "扫码", "png"],
    hot: true,
  },
  {
    slug: "password",
    name: "密码生成器",
    en: "Password",
    desc: "自定义长度与字符集，生成高强度随机密码。",
    category: "generate",
    icon: KeyRound,
    keywords: ["密码", "生成器", "随机", "安全", "password"],
  },
  {
    slug: "uuid",
    name: "UUID 生成器",
    en: "UUID",
    desc: "批量生成 UUID v4，支持大小写与去横线。",
    category: "generate",
    icon: Fingerprint,
    keywords: ["uuid", "guid", "生成", "唯一标识"],
  },
  {
    slug: "random",
    name: "随机数生成",
    en: "Random Number",
    desc: "指定范围与数量，生成不重复随机数。",
    category: "generate",
    icon: Dices,
    keywords: ["随机数", "random", "抽奖", "范围"],
  },
  // ---- business ----
  {
    slug: "quote-compare",
    name: "报价齐",
    en: "Quote Compare",
    desc: "上传多份报价单，AI 自动抽取、匹配、生成可追溯横向对比表。",
    category: "business",
    icon: FileSearch,
    keywords: ["报价", "对比", "比价", "采购", "供应商", "quote"],
    hot: true,
    isNew: true,
  },
  // ---- media ----
  {
    slug: "img-base64",
    name: "图片转 Base64",
    en: "Image to Base64",
    desc: "本地图片转 Base64 / Data URL，可直接嵌入。",
    category: "media",
    icon: ImageIcon,
    keywords: ["图片", "base64", "dataurl", "转换", "image"],
    isNew: true,
  },
  // ---- cross-border ----
  {
    slug: "my-profit",
    name: "马来站利润测算",
    en: "MY Profit",
    desc: "TikTok Shop 马来西亚站利润选品工具：匹配平台费率，测算净利润、保本价与最高采购价。",
    category: "cross-border",
    icon: TrendingUp,
    keywords: ["tiktok", "马来西亚", "利润", "选品", "跨境", "费率", "保本价", "profit"],
    hot: true,
    isNew: true,
  },
  {
    slug: "image-translate",
    name: "图片翻译",
    en: "Image Translate",
    desc: "上传商品图片，自动识别中文并翻译为马来文，AI 修复文字区域。",
    category: "cross-border",
    icon: Languages,
    keywords: ["图片翻译", "中文", "马来文", "跨境", "商品图", "OCR"],
    hot: true,
    isNew: true,
  },
];

export function getTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}

export function toolsByCategory(id: CategoryId): Tool[] {
  return tools.filter((t) => t.category === id);
}

export function getCategory(id: CategoryId): Category {
  return categories.find((c) => c.id === id)!;
}

export function relatedTools(tool: Tool, count = 4): Tool[] {
  const same = tools.filter(
    (t) => t.category === tool.category && t.slug !== tool.slug
  );
  const others = tools.filter((t) => t.category !== tool.category);
  return [...same, ...others].slice(0, count);
}
