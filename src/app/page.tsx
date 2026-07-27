"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  ShieldCheck,
  Zap,
  Gift,
  RefreshCw,
  X,
  ArrowRight,
} from "lucide-react";
import {
  tools,
  categories,
  toolsByCategory,
  type CategoryId,
} from "@/lib/tools";
import ToolCard from "@/components/ToolCard";
import AdSlot from "@/components/AdSlot";

const hotKeywords = ["JSON", "二维码", "时间戳", "Base64", "Markdown", "密码"];

export default function Home() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tools.filter((t) => {
      const hay = [t.name, t.en, t.desc, t.keywords.join(" ")]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  const searching = query.trim().length > 0;

  return (
    <>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden bg-ink text-paper">
        <div className="absolute inset-0 bg-blueprint-dark" />
        <div
          className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #ff4e1b, transparent 70%)" }}
        />
        <div
          className="absolute -right-32 top-20 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #f0b429, transparent 70%)" }}
        />

        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
          <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            免费 · 无需注册 · 数据不出浏览器
          </div>

          <h1 className="animate-rise mt-6 font-display text-5xl leading-[1.05] sm:text-7xl">
            万事有应
            <br />
            <span className="text-accent">一器即用</span>
          </h1>

          <p className="animate-rise mt-5 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
            收录开发者与日常高频小工具。打开就用，用完即走，
            不登录、不上传、不啰嗦。
          </p>

          {/* search */}
          <div className="animate-rise mt-8 max-w-xl">
            <div className="group flex items-center gap-3 rounded-2xl border-2 border-white/15 bg-white p-2 pl-5 shadow-[6px_6px_0_0_rgba(255,78,27,0.9)] transition-colors focus-within:border-accent">
              <Search size={20} className="shrink-0 text-ink/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索工具，如 JSON、二维码、时间戳…"
                className="w-full bg-transparent py-2.5 text-ink placeholder:text-ink/35 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink/40 hover:bg-ink/5"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* hot keywords */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/40">热门：</span>
              {hotKeywords.map((k) => (
                <button
                  key={k}
                  onClick={() => setQuery(k)}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition-colors hover:border-accent hover:text-accent"
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {/* stats */}
          <div className="animate-rise mt-12 flex flex-wrap gap-x-10 gap-y-4">
            {[
              [`${tools.length}+`, "实用工具"],
              [`${categories.length}`, "工具分类"],
              ["0", "注册登录"],
              ["100%", "永久免费"],
            ].map(([num, label]) => (
              <div key={label}>
                <div className="font-display text-3xl text-gold">{num}</div>
                <div className="mt-1 text-xs text-white/50">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ticker */}
        <div className="relative border-t border-white/10 bg-black/20 py-3">
          <div className="flex overflow-hidden">
            <div className="animate-marquee flex shrink-0 items-center gap-8 pr-8">
              {[...tools, ...tools].map((t, i) => (
                <Link
                  key={`${t.slug}-${i}`}
                  href={`/tools/${t.slug}`}
                  className="flex shrink-0 items-center gap-2 text-sm text-white/50 transition-colors hover:text-accent"
                >
                  <t.icon size={14} />
                  {t.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= SEARCH RESULTS ================= */}
      {searching && (
        <section className="mx-auto max-w-6xl px-5 py-12">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">
              “{query}” 的搜索结果
              <span className="ml-2 text-sm font-normal text-muted">
                共 {results.length} 个
              </span>
            </h2>
            <button
              onClick={() => setQuery("")}
              className="text-sm text-accent hover:underline"
            >
              清除搜索
            </button>
          </div>

          {results.length > 0 ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((t) => (
                <ToolCard key={t.slug} tool={t} />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-ink/15 bg-card py-16 text-center text-muted">
              没有找到相关工具，换个关键词试试～
            </div>
          )}
        </section>
      )}

      {/* ================= CATEGORY SECTIONS ================= */}
      {!searching && (
        <div className="mx-auto max-w-6xl px-5">
          {categories.map((cat, idx) => {
            const list = toolsByCategory(cat.id);
            if (list.length === 0) return null;
            return (
              <section
                key={cat.id}
                id={cat.id}
                className="scroll-mt-20 py-12"
              >
                <div className="flex items-end justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span
                      className="font-display text-4xl opacity-25"
                      style={{ color: cat.hex }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h2 className="flex items-center gap-2 text-2xl font-bold">
                        {cat.name}
                        <span
                          className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                          style={{ background: cat.hex }}
                        >
                          {list.length}
                        </span>
                      </h2>
                      <p className="mt-1 text-sm text-muted">{cat.tagline}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => (
                    <ToolCard key={t.slug} tool={t} />
                  ))}
                </div>

                {/* ad between sections */}
                {idx === 1 && <AdSlot variant="banner" className="mt-10" />}
              </section>
            );
          })}
        </div>
      )}

      {/* ================= FEATURES ================= */}
      {!searching && (
        <section className="mx-auto max-w-6xl px-5 pb-8 pt-4">
          <div className="grid gap-4 rounded-2xl border border-ink/10 bg-card p-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: ShieldCheck,
                title: "隐私安全",
                desc: "默认本地浏览器计算；AI 增强功能需服务端处理，使用前明确告知并征得同意。",
              },
              {
                icon: Zap,
                title: "打开即用",
                desc: "无需安装、无需配置，一个链接解决一个问题。",
              },
              {
                icon: Gift,
                title: "永久免费",
                desc: "核心工具完全免费，不注册也能用到全部功能。",
              },
              {
                icon: RefreshCw,
                title: "持续更新",
                desc: "工具库不断扩充，欢迎留言告诉我们你想要什么。",
              },
            ].map((f) => (
              <div key={f.title} className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                  <f.icon size={20} />
                </span>
                <div>
                  <h3 className="font-bold">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted">
              没找到想要的工具？
            </p>
            <Link
              href="/tools/json-format"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-5 py-2.5 text-sm font-bold text-paper transition-transform hover:-translate-y-0.5"
            >
              从最热门的 JSON 格式化开始
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
