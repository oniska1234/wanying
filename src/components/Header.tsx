"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { Menu, X, Sparkles, User, LogOut, Settings, ListChecks, ChevronDown, Crown, Upload } from "lucide-react";
import { categories } from "@/lib/tools";

/** 登录后右上角用户菜单 */
function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = session?.user?.name || session?.user?.email || "用户";
  const initial = name.slice(0, 1).toUpperCase();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-sm transition-colors hover:bg-white/20"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-white">
          {initial}
        </span>
        <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-ink/10 bg-card text-ink shadow-xl">
          <div className="border-b border-ink/10 px-4 py-3">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted">{session?.user?.email}</p>
          </div>
          <nav className="py-1">
            <Link
              href="/my-profit/list"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-ink/5"
            >
              <ListChecks size={15} /> 选品清单
            </Link>
            <Link
              href="/my-profit/import"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-ink/5"
            >
              <Upload size={15} /> 批量导入
            </Link>
            <Link
              href="/my-profit/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-ink/5"
            >
              <Settings size={15} /> 用户设置
            </Link>
            <Link
              href="/my-profit/subscription"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-ink/5"
            >
              <Crown size={15} /> 会员订阅
            </Link>
            {session?.user?.role === "ADMIN" && (
              <Link
                href="/admin/fee-rules"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-ink/5"
              >
                <User size={15} /> 费率管理
              </Link>
            )}
          </nav>
          <div className="border-t border-ink/10 py-1">
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut size={15} /> 退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const { status } = useSession();
  const loggedIn = status === "authenticated";

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
          {loggedIn ? (
            <UserMenu />
          ) : (
            <>
              <Link
                href="/auth/login"
                className="hidden rounded-lg px-3.5 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:inline-block"
              >
                登录
              </Link>
              <Link
                href="/auth/register"
                className="hidden items-center gap-1.5 rounded-lg bg-gold px-3.5 py-2 text-sm font-bold text-ink transition-transform hover:-translate-y-0.5 sm:flex"
              >
                <Sparkles size={15} />
                免费注册
              </Link>
            </>
          )}

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
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-3">
            {loggedIn ? (
              <>
                <Link
                  href="/my-profit/list"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-center text-sm"
                >
                  选品清单
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-center text-sm text-red-300"
                >
                  退出
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-center text-sm"
                >
                  登录
                </Link>
                <Link
                  href="/auth/register"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg bg-gold px-3 py-2 text-center text-sm font-bold text-ink"
                >
                  注册
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
