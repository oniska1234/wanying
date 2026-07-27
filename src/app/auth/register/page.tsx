"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { UserPlus } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "注册失败");
        return;
      }
      // 注册成功后自动登录
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInRes?.error) {
        router.push("/auth/login");
      } else {
        router.push("/my-profit/list");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-2xl border border-ink/10 bg-card p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent font-display text-xl text-white">
            万
          </div>
          <h1 className="mt-4 text-2xl font-bold">注册万应账号</h1>
          <p className="mt-1 text-sm text-muted">免费开始，无需信用卡</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink/60">邮箱</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="you@example.com"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink/60">密码</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="至少 6 位"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink/60">确认密码</span>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="再次输入密码"
            />
          </label>

          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-bold text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)] transition-all hover:bg-accent/90 active:translate-y-0.5 disabled:opacity-50"
          >
            <UserPlus size={16} />
            {loading ? "注册中…" : "注册"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          已有账号？{" "}
          <Link href="/auth/login" className="font-semibold text-accent hover:underline">
            直接登录
          </Link>
        </p>
      </div>
    </div>
  );
}
