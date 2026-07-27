"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Sparkles } from "lucide-react";
import { categories } from "@/lib/tools";

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink text-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        {/* brand */}
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-display text-lg text-white shadow-[3px_3px_0_0_rgba(240,180,41,1)] transition-transform group-hover:-translate-y-0.5">
            万
          </span>
          <span className="font-display text-xl tracking-wide">万应</span>
          <span className="hidden text-xs text-white/40 sm:inline">
            WANYING
          </span>
        </Link>

        {/* desktop nav */}
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {categories.map((c) => (
            <a
              key={c.id}
              href={`/#${c.id}`}
              className="rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {c.name}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-3">
          <button className="hidden items-center gap-1.5 rounded-lg bg-gold px-3.5 py-2 text-sm font-bold text-ink transition-transform hover:-translate-y-0.5 sm:flex">
            <Sparkles size={15} />
            开通会员
          </button>

          {/* mobile toggle */}
          <button
            aria-label="菜单"
            onClick={() => setOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 md:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* mobile menu */}
      {open && (
        <nav className="border-t border-white/10 bg-ink px-5 py-3 md:hidden">
          {categories.map((c) => (
            <a
              key={c.id}
              href={`/#${c.id}`}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2.5 text-sm text-white/80 hover:bg-white/10"
            >
              {c.name}
              <span className="ml-2 text-xs text-white/40">{c.tagline}</span>
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
