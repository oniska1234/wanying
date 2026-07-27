import Link from "next/link";
import { categories, toolsByCategory } from "@/lib/tools";

export default function Footer() {
  return (
    <footer className="mt-20 bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          {/* brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-display text-lg text-white">
                万
              </span>
              <span className="font-display text-xl tracking-wide">万应</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              万事有应，一器即用。免费、无需注册；多数工具数据不出浏览器，
              AI 增强功能（如报价齐百炼抽取）需经服务端调用模型服务，使用前会明确告知并征得同意。
            </p>
          </div>

          {/* category columns */}
          {categories.map((c) => (
            <div key={c.id}>
              <h4 className="text-sm font-bold text-white/90">{c.name}</h4>
              <ul className="mt-3 space-y-2">
                {toolsByCategory(c.id)
                  .slice(0, 5)
                  .map((t) => (
                    <li key={t.slug}>
                      <Link
                        href={`/tools/${t.slug}`}
                        className="text-sm text-white/50 transition-colors hover:text-accent"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} 万应 WANYING · 工具让生活更简单</p>
          <p>
            默认本地浏览器计算 · AI 功能需服务端处理（使用前告知并征得同意） ·{" "}
            <span className="text-white/60">备案号占位</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
