"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Check } from "lucide-react";

export interface SettingsData {
  name: string | null;
  email: string | null;
  defaultCurrency: string;
  defaultShopType: string;
  locale: string;
}

const CURRENCIES = [
  { value: "CNY", label: "人民币 ¥（CNY）" },
  { value: "MYR", label: "马币 RM（MYR）" },
];
const SHOP_TYPES = [
  { value: "MARKETPLACE", label: "Marketplace（普通店）" },
  { value: "MALL", label: "Mall（品牌店）" },
];

export default function SettingsForm({ initial }: { initial: SettingsData }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? "");
  const [defaultCurrency, setCurrency] = useState(initial.defaultCurrency);
  const [defaultShopType, setShopType] = useState(initial.defaultShopType);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/my-profit/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, defaultCurrency, defaultShopType, locale: "zh" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink/60">昵称</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="你的昵称"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink/60">登录邮箱</span>
        <input
          value={initial.email ?? ""}
          disabled
          className="w-full cursor-not-allowed rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-muted"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink/60">默认币种（成本录入）</span>
        <select
          value={defaultCurrency}
          onChange={(e) => setCurrency(e.target.value)}
          className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink/60">默认店铺类型</span>
        <select
          value={defaultShopType}
          onChange={(e) => setShopType(e.target.value)}
          className="w-full rounded-lg border border-ink/15 bg-paper/60 px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          {SHOP_TYPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink/60">界面语言</span>
        <div className="rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-muted">
          简体中文（首版仅支持中文）
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)] transition-all hover:bg-accent/90 active:translate-y-0.5 disabled:opacity-50"
      >
        {saved ? <Check size={16} /> : <Save size={16} />}
        {saving ? "保存中…" : saved ? "已保存" : "保存设置"}
      </button>
    </form>
  );
}
