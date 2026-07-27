"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, KeyRound, Check } from "lucide-react";

const PRO_FEATURES = [
  "不限次数利润计算",
  "多 SKU 与无限选品清单",
  "CSV 批量导出 + 成本模板",
  "完整情景分析（乐观/正常/悲观）",
  "费率更新提醒",
];
const FREE_FEATURES = ["每日最多 10 次计算", "最多保存 10 个选品", "基础利润计算"];

export default function SubscriptionForm({
  plan,
  expiresAt,
}: {
  plan: "FREE" | "PRO";
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOk(false);
    setLoading(true);
    try {
      const res = await fetch("/api/my-profit/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "兑换失败");
        return;
      }
      setOk(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* 免费版 */}
      <div className="rounded-2xl border border-ink/10 bg-card p-6">
        <h2 className="text-lg font-bold">免费版</h2>
        <p className="mt-1 text-sm text-muted">适合刚开始选品的卖家</p>
        <ul className="mt-4 space-y-2 text-sm">
          {FREE_FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-2 text-ink/70">
              <Check size={15} className="text-ink/40" /> {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Pro 版 */}
      <div className="relative rounded-2xl border-2 border-accent bg-card p-6">
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-bold text-white">
          <Crown size={13} /> 推荐
        </span>
        <h2 className="text-lg font-bold">Pro 版</h2>
        <p className="mt-1 text-sm text-muted">
          {plan === "PRO"
            ? expiresAt
              ? `已开通 · 有效期至 ${new Date(expiresAt).toLocaleDateString("zh-CN")}`
              : "已开通"
            : "专业跨境卖家之选"}
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {PRO_FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-2 text-ink/80">
              <Check size={15} className="text-accent" /> {f}
            </li>
          ))}
        </ul>

        {plan !== "PRO" && (
          <form onSubmit={redeem} className="mt-5 space-y-3 border-t border-ink/10 pt-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink/60">兑换码</span>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="输入兑换码开通 Pro"
                  className="w-full rounded-lg border border-ink/15 bg-paper/60 py-2.5 pl-9 pr-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {ok && <p className="text-sm text-emerald-600">🎉 兑换成功，已开通 Pro！</p>}
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)] transition-all hover:bg-accent/90 active:translate-y-0.5 disabled:opacity-50"
            >
              <Crown size={15} />
              {loading ? "兑换中…" : "立即兑换"}
            </button>
            <p className="text-center text-xs text-muted">MVP 阶段通过兑换码开通，暂不接入在线支付。</p>
          </form>
        )}
      </div>
    </div>
  );
}
