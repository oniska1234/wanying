import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import {
  tools,
  getTool,
  getCategory,
  relatedTools,
  type Tool,
  type Category,
} from "@/lib/tools";
import ToolRenderer from "@/components/ToolRenderer";
import ToolCard from "@/components/ToolCard";
import AdSlot from "@/components/AdSlot";
import { getSiteUrl, SITE_NAME } from "@/lib/site";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return tools.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  const path = `/tools/${tool.slug}`;
  const title = `${tool.name} - ${tool.en} 免费在线工具`;
  return {
    title,
    description: tool.desc,
    keywords: tool.keywords,
    alternates: {
      canonical: path,
    },
    openGraph: {
      type: "website",
      title,
      description: tool.desc,
      url: path,
      locale: "zh_CN",
    },
  };
}

/** 工具页 JSON-LD：面包屑 + WebApplication（结构化数据） */
function ToolJsonLd({ tool, cat }: { tool: Tool; cat: Category }) {
  const url = getSiteUrl();
  const pageUrl = `${url}/tools/${tool.slug}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首页", item: url },
          {
            "@type": "ListItem",
            position: 2,
            name: cat.name,
            item: `${url}/#${cat.id}`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: tool.name,
            item: pageUrl,
          },
        ],
      },
      {
        "@type": "WebApplication",
        name: `${tool.name}（${tool.en}）`,
        alternateName: tool.en,
        description: tool.desc,
        url: pageUrl,
        applicationCategory: "UtilityApplication",
        operatingSystem: "Web",
        inLanguage: "zh-CN",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "CNY",
        },
        publisher: { "@type": "Organization", name: SITE_NAME, url },
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

export default async function ToolPage({ params }: Props) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const cat = getCategory(tool.category);
  const related = relatedTools(tool);
  const Icon = tool.icon;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <ToolJsonLd tool={tool} cat={cat} />
      {/* breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/" className="flex items-center gap-1 hover:text-accent">
          <Home size={14} /> 首页
        </Link>
        <ChevronRight size={14} />
        <a href={`/#${cat.id}`} className="hover:text-accent">
          {cat.name}
        </a>
        <ChevronRight size={14} />
        <span className="text-ink">{tool.name}</span>
      </nav>

      {/* header */}
      <header className="mt-5 flex items-start gap-4">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-xl"
          style={{ background: `${cat.hex}1a`, color: cat.hex }}
        >
          <Icon size={28} />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold sm:text-3xl">{tool.name}</h1>
            <span
              className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
              style={{ background: cat.hex }}
            >
              {cat.name}
            </span>
          </div>
          <p className="mt-1.5 text-muted">{tool.desc}</p>
        </div>
      </header>

      {/* tool body */}
      <div className="mt-7">
        <ToolRenderer slug={slug} />
      </div>

      {/* ad */}
      <AdSlot variant="banner" className="mt-10" />

      {/* related */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">相关工具</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {related.map((t) => (
            <ToolCard key={t.slug} tool={t} />
          ))}
        </div>
      </section>
    </div>
  );
}
