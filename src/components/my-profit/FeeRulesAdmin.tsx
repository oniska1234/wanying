"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus, Upload, AlertTriangle, CheckCircle2, Archive, Trash2, Pencil, RefreshCw,
} from "lucide-react";

interface Rule {
  id: string;
  feeType: string;
  category: string;
  shopType: string;
  bxpStatus: string;
  rate: number | null;
  fixedAmount: number | null;
  perUnit: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  status: string;
  source: string | null;
  hasConflict?: boolean;
}
interface Conflict {
  feeType: string;
  category: string;
  shopType: string;
  bxpStatus: string;
  message: string;
}

const FEE_TYPE_LABEL: Record<string, string> = {
  COMMISSION: "佣金",
  TRANSACTION: "交易费",
  PLATFORM_SUPPORT: "平台支持费",
};
const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", ARCHIVED: "已归档" };
const STATUS_CLS: Record<string, string> = {
  DRAFT: "bg-ink/10 text-ink/60",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  ARCHIVED: "bg-red-100 text-red-500",
};

const EMPTY_FORM = {
  feeType: "COMMISSION",
  category: "*",
  shopType: "MARKETPLACE",
  bxpStatus: "NON_BXP",
  rate: "",
  fixedAmount: "",
  perUnit: "REVENUE",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  source: "",
  note: "",
};

export default function FeeRulesAdmin() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("PUBLISHED");
  const [feeType, setFeeType] = useState("ALL");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status, feeType });
    if (q.trim()) params.set("q", q.trim());
    try {
      const res = await fetch(`/api/my-profit/admin/fee-rules?${params}`);
      const data = await res.json();
      setRules(data.rules || []);
      setConflicts(data.conflicts || []);
    } finally {
      setLoading(false);
    }
  }, [status, feeType, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/my-profit/admin/fee-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        rate: form.rate === "" ? null : Number(form.rate),
        fixedAmount: form.fixedAmount === "" ? null : Number(form.fixedAmount),
        effectiveTo: form.effectiveTo || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) return flash("err", data.error || "创建失败");
    flash("ok", "规则已创建（草稿），可发布生效");
    setShowForm(false);
    setForm(EMPTY_FORM);
    load();
  };

  const doAction = async (id: string, action: "publish" | "archive") => {
    const res = await fetch(`/api/my-profit/admin/fee-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) return flash("err", data.error || "操作失败");
    flash("ok", action === "publish" ? "已发布（同维度旧规则自动归档）" : "已归档（回滚）");
    load();
  };

  const remove = async (id: string) => {
    if (!window.confirm("确定删除该规则？")) return;
    await fetch(`/api/my-profit/admin/fee-rules/${id}`, { method: "DELETE" });
    flash("ok", "已删除");
    load();
  };

  const editRate = async (rule: Rule) => {
    const input = window.prompt(
      `修改费率（当前 ${rule.rate ?? "-"}）`,
      rule.rate?.toString() ?? ""
    );
    if (input === null) return;
    const res = await fetch(`/api/my-profit/admin/fee-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: input === "" ? null : Number(input) }),
    });
    const data = await res.json();
    if (!res.ok) return flash("err", data.error || "更新失败");
    flash("ok", "已更新，规则回退为草稿，需重新发布");
    load();
  };

  const importCsv = async () => {
    const res = await fetch("/api/my-profit/admin/fee-rules/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    const data = await res.json();
    if (!res.ok) return flash("err", data.error || "导入失败");
    flash("ok", `导入成功 ${data.imported} 条${data.errors?.length ? `，${data.errors.length} 条失败` : ""}`);
    if (data.errors?.length) console.warn(data.errors);
    setShowImport(false);
    setCsv("");
    load();
  };

  return (
    <div className="space-y-4">
      {/* 冲突提醒 */}
      {conflicts.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={15} /> 检测到 {conflicts.length} 组规则冲突
          </p>
          {conflicts.map((c, i) => (
            <p key={i} className="text-xs">
              {FEE_TYPE_LABEL[c.feeType]} · {c.category} · {c.shopType} · {c.bxpStatus}：{c.message}
            </p>
          ))}
        </div>
      )}

      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.type === "ok" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索类目…"
          className="min-w-[140px] rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm">
          <option value="ALL">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PUBLISHED">已发布</option>
          <option value="ARCHIVED">已归档</option>
        </select>
        <select value={feeType} onChange={(e) => setFeeType(e.target.value)} className="rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm">
          <option value="ALL">全部类型</option>
          <option value="COMMISSION">佣金</option>
          <option value="TRANSACTION">交易费</option>
          <option value="PLATFORM_SUPPORT">平台支持费</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowImport((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm font-semibold hover:bg-ink/5">
            <Upload size={15} /> CSV 导入
          </button>
          <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white hover:bg-accent/90">
            <Plus size={15} /> 新建规则
          </button>
        </div>
      </div>

      {/* CSV 导入区 */}
      {showImport && (
        <div className="space-y-2 rounded-xl border border-ink/10 bg-card p-4">
          <p className="text-xs text-muted">
            表头：feeType,category,shopType,bxpStatus,rate,fixedAmount,perUnit,effectiveFrom,effectiveTo,source（导入为草稿）
          </p>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder={"feeType,category,shopType,bxpStatus,rate,perUnit,effectiveFrom\nCOMMISSION,Electronics,MARKETPLACE,NON_BXP,0.05,REVENUE,2026-01-01"}
            className="w-full rounded-lg border border-ink/15 bg-paper/60 p-3 font-mono text-xs"
          />
          <button onClick={importCsv} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white">
            开始导入
          </button>
        </div>
      )}

      {/* 新建表单 */}
      {showForm && (
        <form onSubmit={create} className="grid gap-3 rounded-xl border border-ink/10 bg-card p-4 sm:grid-cols-3">
          <label className="text-xs">费用类型
            <select value={form.feeType} onChange={(e) => setForm({ ...form, feeType: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm">
              <option value="COMMISSION">佣金</option>
              <option value="TRANSACTION">交易费</option>
              <option value="PLATFORM_SUPPORT">平台支持费</option>
            </select>
          </label>
          <label className="text-xs">类目（* 为站点默认）
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm" />
          </label>
          <label className="text-xs">计费单位
            <select value={form.perUnit} onChange={(e) => setForm({ ...form, perUnit: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm">
              <option value="REVENUE">按销售额比例</option>
              <option value="ORDER">按订单</option>
              <option value="ITEM">按件</option>
            </select>
          </label>
          <label className="text-xs">店铺类型
            <select value={form.shopType} onChange={(e) => setForm({ ...form, shopType: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm">
              <option value="MARKETPLACE">Marketplace</option>
              <option value="MALL">Mall</option>
            </select>
          </label>
          <label className="text-xs">BXP 状态
            <select value={form.bxpStatus} onChange={(e) => setForm({ ...form, bxpStatus: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm">
              <option value="NON_BXP">非 BXP</option>
              <option value="BXP">BXP</option>
              <option value="UNCERTAIN">不确定</option>
            </select>
          </label>
          <label className="text-xs">比例费率（如 0.05）
            <input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0.05" className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm" />
          </label>
          <label className="text-xs">固定金额（RM）
            <input value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })} placeholder="可选" className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm" />
          </label>
          <label className="text-xs">生效开始
            <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm" />
          </label>
          <label className="text-xs">生效结束（可选/未来）
            <input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm" />
          </label>
          <label className="text-xs sm:col-span-2">来源链接
            <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="https://seller.tiktokglobalshop.com/…" className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-2 text-sm" />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white">创建</button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-ink/15 px-3 py-2 text-sm">取消</button>
          </div>
        </form>
      )}

      {/* 规则表 */}
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-ink/15 bg-card py-16 text-sm text-muted">
          <RefreshCw size={20} className="mb-2 animate-spin" /> 加载中…
        </div>
      ) : rules.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-ink/15 bg-card py-16 text-sm text-muted">
          无匹配规则
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/[0.03] text-left text-xs text-ink/50">
                <th className="px-3 py-3">类型</th>
                <th className="px-3 py-3">类目</th>
                <th className="px-3 py-3">店铺/BXP</th>
                <th className="px-3 py-3 text-right">费率/金额</th>
                <th className="px-3 py-3">生效区间</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={`border-b border-ink/5 last:border-0 ${r.hasConflict ? "bg-amber-50/60" : "hover:bg-ink/[0.02]"}`}>
                  <td className="px-3 py-3 font-medium">{FEE_TYPE_LABEL[r.feeType]}</td>
                  <td className="px-3 py-3">{r.category === "*" ? <span className="text-muted">站点默认</span> : r.category}</td>
                  <td className="px-3 py-3 text-xs text-ink/60">{r.shopType}<br />{r.bxpStatus}</td>
                  <td className="px-3 py-3 text-right">
                    {r.rate !== null ? `${(r.rate * 100).toFixed(2)}%` : "—"}
                    {r.fixedAmount !== null ? <span className="block text-xs text-muted">RM {r.fixedAmount}/{r.perUnit}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-xs text-ink/60">
                    {r.effectiveFrom.slice(0, 10)}
                    <br />→ {r.effectiveTo ? r.effectiveTo.slice(0, 10) : "长期"}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${STATUS_CLS[r.status]}`}>
                      {STATUS_LABEL[r.status]} v{r.version}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 text-ink/50">
                      {r.status !== "PUBLISHED" && (
                        <button title="发布" onClick={() => doAction(r.id, "publish")} className="rounded p-1.5 hover:bg-emerald-100 hover:text-emerald-600">
                          <CheckCircle2 size={15} />
                        </button>
                      )}
                      {r.status === "PUBLISHED" && (
                        <button title="归档(回滚)" onClick={() => doAction(r.id, "archive")} className="rounded p-1.5 hover:bg-amber-100 hover:text-amber-600">
                          <Archive size={15} />
                        </button>
                      )}
                      <button title="改费率" onClick={() => editRate(r)} className="rounded p-1.5 hover:bg-ink/10 hover:text-accent">
                        <Pencil size={14} />
                      </button>
                      <button title="删除" onClick={() => remove(r.id)} className="rounded p-1.5 hover:bg-red-100 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
