"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Search, Download, Upload, Trash2, PackageOpen, Tag, StickyNote, RefreshCw, Plus,
} from "lucide-react";

interface SkuCalc {
  netProfit: number;
  netMargin: number;
  breakEvenPrice: number | null;
  maxPurchasePrice: number | null;
  resultSnapshot?: { matchLevel?: string; ruleWarning?: string };
}
interface ProductRow {
  id: string;
  name: string;
  category: string;
  shopType: string;
  bxpStatus: string;
  status: string;
  tags: string[];
  note: string | null;
  updatedAt: string;
  skus: Array<{ calculation: SkuCalc | null }>;
}

const STATUS_OPTIONS = [
  { value: "PENDING", label: "待评估", cls: "bg-ink/10 text-ink/70" },
  { value: "CANDIDATE", label: "候选", cls: "bg-blue-100 text-blue-700" },
  { value: "SAMPLING", label: "打样", cls: "bg-amber-100 text-amber-700" },
  { value: "ABANDONED", label: "放弃", cls: "bg-red-100 text-red-600" },
  { value: "LISTED", label: "已上架", cls: "bg-emerald-100 text-emerald-700" },
];
const statusMeta = (s: string) => STATUS_OPTIONS.find((o) => o.value === s) || STATUS_OPTIONS[0];

const SORTS = [
  { value: "updatedAt_desc", label: "最近更新" },
  { value: "createdAt_desc", label: "最新创建" },
  { value: "name_asc", label: "名称 A→Z" },
];

function money(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined) return "—";
  return `RM ${v.toFixed(digits)}`;
}

export default function ProductList({ plan }: { plan: "FREE" | "PRO" }) {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("updatedAt_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  // 编辑弹窗状态
  const [editModal, setEditModal] = useState<{ type: "tags" | "note"; row: ProductRow } | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ sort });
    if (q.trim()) params.set("q", q.trim());
    if (status !== "ALL") params.set("status", status);
    try {
      const res = await fetch(`/api/my-profit/products?${params}`);
      const data = await res.json();
      setRows(data.products || []);
    } finally {
      setLoading(false);
    }
  }, [q, status, sort]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2500);
  };

  const changeStatus = async (id: string, newStatus: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
    await fetch(`/api/my-profit/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const editTags = (row: ProductRow) => {
    setEditModal({ type: "tags", row });
    setEditValue(row.tags.join(", "));
  };

  const editNote = (row: ProductRow) => {
    setEditModal({ type: "note", row });
    setEditValue(row.note || "");
  };

  const saveEdit = async () => {
    if (!editModal) return;
    const { type, row } = editModal;
    const payload = type === "tags"
      ? { tags: editValue.split(/[,，]/).map((t) => t.trim()).filter(Boolean) }
      : { note: editValue };
    await fetch(`/api/my-profit/products/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditModal(null);
    load();
  };

  const removeOne = async (id: string) => {
    if (!window.confirm("确定删除该商品？")) return;
    await fetch(`/api/my-profit/products/${id}`, { method: "DELETE" });
    flash("已删除");
    load();
  };

  const batchDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selected.size} 个商品？`)) return;
    await fetch(`/api/my-profit/products/batch-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    setSelected(new Set());
    flash("批量删除完成");
    load();
  };

  const exportCsv = async () => {
    const res = await fetch(`/api/my-profit/products/export`);
    const data = await res.json();
    if (!res.ok) {
      flash(data.error || "导出失败");
      return;
    }
    window.location.href = data.url;
  };

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索商品名称…"
            className="w-full rounded-lg border border-ink/15 bg-card py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm"
        >
          <option value="ALL">全部状态</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm"
        >
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={exportCsv}
          title={plan === "PRO" ? "导出 CSV" : "Pro 功能"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm font-semibold hover:bg-ink/5"
        >
          <Download size={15} /> 导出
        </button>
        <Link
          href="/my-profit/import"
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm font-semibold hover:bg-ink/5"
        >
          <Upload size={15} /> 导入
        </Link>
        <Link
          href="/tools/my-profit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white hover:bg-accent/90"
        >
          <Plus size={15} /> 新建计算
        </Link>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm">
          <span className="text-red-700">已选 {selected.size} 项</span>
          <button onClick={batchDelete} className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline">
            <Trash2 size={14} /> 批量删除
          </button>
        </div>
      )}

      {msg && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-ink/15 bg-card py-20 text-sm text-muted">
          <RefreshCw size={20} className="mb-2 animate-spin" /> 加载中…
        </div>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-ink/15 bg-card py-20 text-center">
          <PackageOpen size={32} className="mb-3 text-ink/30" />
          <p className="text-sm font-semibold text-ink/70">还没有保存的选品</p>
          <p className="mt-1 text-xs text-muted">在计算器中点击「保存到选品清单」开始记录</p>
          <Link href="/tools/my-profit" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white">
            <Plus size={15} /> 去计算
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/[0.03] text-left text-xs text-ink/50">
                <th className="px-3 py-3">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <th className="px-3 py-3">商品</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3 text-right">净利润</th>
                <th className="px-3 py-3 text-right">净利率</th>
                <th className="px-3 py-3 text-right">保本价</th>
                <th className="px-3 py-3 text-right">最高采购价</th>
                <th className="px-3 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const calc = r.skus[0]?.calculation;
                const sm = statusMeta(r.status);
                const marginPct = calc ? (calc.netMargin * 100).toFixed(1) : "—";
                const profitPositive = calc ? calc.netProfit >= 0 : true;
                return (
                  <tr key={r.id} className="border-b border-ink/5 last:border-0 hover:bg-ink/[0.02]">
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold">{r.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                        <span>{r.category || "通用"}</span>
                        {calc?.resultSnapshot?.matchLevel === "default" && r.category && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700" title="该类目未找到精确费率，使用通用默认费率">通用费率</span>
                        )}
                        <span>·</span>
                        <span>{r.shopType}</span>
                        {r.tags.map((t) => (
                          <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${sm.cls}`}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className={`px-3 py-3 text-right font-semibold ${profitPositive ? "text-emerald-600" : "text-red-600"}`}>
                      {money(calc?.netProfit)}
                    </td>
                    <td className="px-3 py-3 text-right">{marginPct === "—" ? "—" : `${marginPct}%`}</td>
                    <td className="px-3 py-3 text-right">{money(calc?.breakEvenPrice)}</td>
                    <td className="px-3 py-3 text-right">
                      {calc?.maxPurchasePrice == null ? "—" : `¥${calc.maxPurchasePrice.toFixed(2)}`}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 text-ink/50">
                        <button title="标签" onClick={() => editTags(r)} className="rounded p-1.5 hover:bg-ink/10 hover:text-accent">
                          <Tag size={14} />
                        </button>
                        <button title="备注" onClick={() => editNote(r)} className="rounded p-1.5 hover:bg-ink/10 hover:text-accent">
                          <StickyNote size={14} />
                        </button>
                        <button title="删除" onClick={() => removeOne(r.id)} className="rounded p-1.5 hover:bg-red-100 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑标签/备注弹窗 */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid={`edit-${editModal.type}-modal`}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold">
              {editModal.type === "tags" ? "编辑标签" : "编辑备注"}
            </h3>
            <p className="mt-1 text-xs text-gray-500">{editModal.row.name}</p>
            {editModal.type === "tags" ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="用逗号分隔多个标签"
                data-testid="edit-tags-input"
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                autoFocus
              />
            ) : (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="备注信息"
                rows={3}
                data-testid="edit-note-input"
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                autoFocus
              />
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                data-testid="edit-save-btn"
                className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
