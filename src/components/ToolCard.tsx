import Link from "next/link";
import { ArrowUpRight, Flame } from "lucide-react";
import { getCategory, type Tool } from "@/lib/tools";

export default function ToolCard({ tool }: { tool: Tool }) {
  const cat = getCategory(tool.category);
  const Icon = tool.icon;

  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-ink/10 bg-card p-5 transition-all duration-200 hover:-translate-y-1 hover:border-ink/20 hover:shadow-[6px_6px_0_0_rgba(21,24,30,0.08)]"
    >
      {/* category accent bar */}
      <span
        className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
        style={{ background: cat.hex }}
      />

      <div className="flex items-start justify-between">
        <span
          className="grid h-11 w-11 place-items-center rounded-lg transition-transform group-hover:scale-110"
          style={{ background: `${cat.hex}1a`, color: cat.hex }}
        >
          <Icon size={22} strokeWidth={2} />
        </span>

        <div className="flex items-center gap-1.5">
          {tool.hot && (
            <span className="flex items-center gap-0.5 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
              <Flame size={11} /> 热门
            </span>
          )}
          {tool.isNew && (
            <span className="rounded-full bg-pine/10 px-2 py-0.5 text-[10px] font-bold text-pine">
              NEW
            </span>
          )}
        </div>
      </div>

      <h3 className="mt-4 flex items-center gap-1 font-bold text-ink">
        {tool.name}
        <ArrowUpRight
          size={15}
          className="text-ink/30 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
        />
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{tool.desc}</p>

      <span
        className="mt-4 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: cat.hex }}
      >
        {cat.name}
      </span>
    </Link>
  );
}
