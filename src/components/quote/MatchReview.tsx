"use client";

import { useState } from "react";
import {
  Link2,
  AlertTriangle,
  Package,
  Check,
  Unlink,
  GitMerge,
  Undo2,
  PencilLine,
  XCircle,
} from "lucide-react";
import { Btn } from "@/components/ui";
import { fmtPrice } from "@/lib/quote-utils";
import type {
  ComparisonProject,
  MatchGroup,
  MatchStatus,
  LineItem,
} from "@/lib/quote-types";

interface Props {
  project: ComparisonProject;
  onUpdateGroups: (groups: MatchGroup[]) => void;
  onContinue: () => void;
}

const statusConfig: Record<
  MatchStatus,
  { label: string; cls: string; icon: typeof Link2 }
> = {
  confirmed: { label: "确定匹配", cls: "bg-pine/10 text-pine", icon: Check },
  possible: { label: "可能匹配", cls: "bg-gold/10 text-gold", icon: AlertTriangle },
  unmatched: { label: "不匹配", cls: "bg-accent/10 text-accent", icon: AlertTriangle },
  unique: { label: "独有项目", cls: "bg-ink/5 text-ink/50", icon: Package },
};

export default function MatchReview({ project, onUpdateGroups, onContinue }: Props) {
  const groups = project.matchGroups;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 撤销历史（仅结构操作：合并 / 拆出 / 拒绝 / 状态切换）
  const [history, setHistory] = useState<MatchGroup[][]>([]);
  // 审计轨迹
  const [audit, setAudit] = useState<string[]>([]);

  const docs = project.documents.filter((d) => d.analyzed !== false);
  const getItem = (id: string): LineItem | undefined =>
    docs.flatMap((d) => d.lineItems).find((li) => li.id === id);
  const getDoc = (liId: string) =>
    docs.find((d) => d.lineItems.some((li) => li.id === liId));

  const confirmedCount = groups.filter((g) => g.status === "confirmed").length;
  const possibleCount = groups.filter((g) => g.status === "possible").length;
  const uniqueCount = groups.filter((g) => g.status === "unique").length;

  // 快照当前分组以便撤销，并记一条审计
  const commit = (next: MatchGroup[], note: string) => {
    const ts = new Date().toLocaleTimeString();
    setHistory((h) => [...h, groups].slice(-30));
    setAudit((a) => [`${ts} ${note}`, ...a].slice(0, 30));
    onUpdateGroups(next);
  };
  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const ts = new Date().toLocaleTimeString();
    setHistory((h) => h.slice(0, -1));
    setAudit((a) => [`${ts} 撤销上一步操作`, ...a].slice(0, 30));
    onUpdateGroups(prev);
  };

  // ---- 操作 ----
  const setStatus = (id: string, status: MatchStatus) => {
    commit(
      groups.map((g) => (g.id === id ? { ...g, status, userConfirmed: true } : g)),
      `将「${groups.find((g) => g.id === id)?.normalizedName}」标为${status}`
    );
  };

  /** 编辑分组的标准名称 / 标准规格（不影响成员，仅改展示与导出表头） */
  const editGroup = (id: string, patch: Partial<MatchGroup>) => {
    onUpdateGroups(
      groups.map((g) => (g.id === id ? { ...g, ...patch, userConfirmed: true } : g))
    );
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mergeSelected = () => {
    const sel = groups.filter((g) => selected.has(g.id));
    if (sel.length < 2) return;
    const merged: MatchGroup = {
      id: `mg-merged-${crypto.randomUUID()}`,
      normalizedName: sel[0].normalizedName,
      normalizedSpec: Array.from(new Set(sel.map((s) => s.normalizedSpec).filter(Boolean))).join(" / "),
      status: "confirmed",
      reason: `人工合并 ${sel.length} 组`,
      lineItemIds: sel.flatMap((s) => s.lineItemIds),
      userConfirmed: true,
    };
    const rest = groups.filter((g) => !selected.has(g.id));
    commit([merged, ...rest], `合并 ${sel.length} 组为「${merged.normalizedName}」`);
    setSelected(new Set());
  };

  /** 拒绝匹配：把该组拆回为各成员独立成组 */
  const rejectGroup = (group: MatchGroup) => {
    if (group.lineItemIds.length < 2) return;
    const uniques: MatchGroup[] = group.lineItemIds.map((liId) => {
      const item = getItem(liId);
      return {
        id: `mg-reject-${crypto.randomUUID()}`,
        normalizedName: item?.originalName ?? "独立项目",
        normalizedSpec: item?.spec ?? "",
        status: "unique" as const,
        reason: "人工拒绝匹配，拆为独立项目",
        lineItemIds: [liId],
        userConfirmed: true,
      };
    });
    const rest = groups.filter((g) => g.id !== group.id);
    commit([...rest, ...uniques], `拒绝「${group.normalizedName}」的匹配，拆为 ${uniques.length} 项`);
  };

  const splitItem = (group: MatchGroup, liId: string) => {
    const item = getItem(liId);
    const remaining = group.lineItemIds.filter((id) => id !== liId);
    const newGroup: MatchGroup = {
      id: `mg-split-${crypto.randomUUID()}`,
      normalizedName: item?.normalizedName ?? "拆出项目",
      normalizedSpec: item?.spec ?? "",
      status: "unique",
      reason: "人工拆分独立成组",
      lineItemIds: [liId],
      userConfirmed: true,
    };
    if (remaining.length === 0) {
      commit(groups.map((g) => (g.id === group.id ? newGroup : g)), `拆出「${item?.originalName}」`);
    } else {
      commit(
        [
          ...groups.map((g) =>
            g.id === group.id ? { ...g, lineItemIds: remaining } : g
          ),
          newGroup,
        ],
        `从「${group.normalizedName}」拆出「${item?.originalName}」`
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* summary */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-pine/10 px-3 py-1.5 text-sm font-semibold text-pine">
          确定匹配 {confirmedCount} 组
        </span>
        {possibleCount > 0 && (
          <span className="rounded-lg bg-gold/10 px-3 py-1.5 text-sm font-semibold text-gold">
            需确认 {possibleCount} 组
          </span>
        )}
        <span className="rounded-lg bg-ink/5 px-3 py-1.5 text-sm font-semibold text-ink/50">
          独有 {uniqueCount} 项
        </span>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <GitMerge size={13} className="text-[#3b5bdb]" />
        勾选多个分组可合并；可直接编辑「标准名称 / 规格」；点「拆出」独立成项、「拒绝拆分」取消整组匹配；所有操作可「撤销」并记入操作记录。
      </p>

      {/* merge toolbar */}
      {selected.size >= 2 && (
        <div className="sticky top-2 z-20 flex items-center justify-between rounded-lg border border-[#3b5bdb]/30 bg-[#3b5bdb]/10 px-4 py-2.5">
          <span className="text-sm font-semibold text-[#3b5bdb]">
            已选 {selected.size} 组
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-md px-3 py-1 text-xs font-semibold text-ink/60 hover:bg-ink/5"
            >
              取消
            </button>
            <button
              onClick={mergeSelected}
              className="flex items-center gap-1 rounded-md bg-[#3b5bdb] px-3 py-1 text-xs font-bold text-white"
            >
              <GitMerge size={13} /> 合并所选
            </button>
          </div>
        </div>
      )}

      {/* 撤销 + 操作记录 */}
      {(history.length > 0 || audit.length > 0) && (
        <div className="flex items-center gap-3 rounded-lg border border-ink/10 bg-paper-2/60 px-3 py-2">
          <button
            onClick={undo}
            disabled={history.length === 0}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-ink/5 disabled:opacity-40"
          >
            <Undo2 size={13} /> 撤销{history.length > 0 ? `（${history.length}）` : ""}
          </button>
          {audit.length > 0 && (
            <details className="ml-auto text-xs text-muted">
              <summary className="flex cursor-pointer items-center gap-1 font-semibold text-ink/50">
                <PencilLine size={12} /> 操作记录（{audit.length}）
              </summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto pr-2">
                {audit.map((a, i) => (
                  <li key={i}>· {a}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* groups */}
      <div className="space-y-4">
        {groups.map((group) => {
          const cfg = statusConfig[group.status];
          const Icon = cfg.icon;
          const isSelected = selected.has(group.id);
          return (
            <div
              key={group.id}
              className={`rounded-xl border p-4 transition-colors ${
                isSelected
                  ? "border-[#3b5bdb] bg-[#3b5bdb]/5"
                  : group.status === "possible"
                    ? "border-gold/40 bg-gold/5"
                    : "border-ink/10 bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(group.id)}
                    className="mt-1 accent-[#3b5bdb]"
                    title="选择以合并"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <input
                        value={group.normalizedName}
                        onChange={(e) => editGroup(group.id, { normalizedName: e.target.value })}
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-bold outline-none hover:border-ink/10 focus:border-[#3b5bdb] focus:bg-white"
                        title="标准名称（可编辑，影响对比表与导出表头）"
                      />
                      <span
                        className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${cfg.cls}`}
                      >
                        <Icon size={12} /> {cfg.label}
                      </span>
                      {group.userConfirmed && (
                        <span className="shrink-0 rounded-md bg-[#3b5bdb]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#3b5bdb]">
                          已人工确认
                        </span>
                      )}
                    </div>
                    <input
                      value={group.normalizedSpec}
                      onChange={(e) => editGroup(group.id, { normalizedSpec: e.target.value })}
                      placeholder="标准规格（可编辑）"
                      className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 text-xs text-muted outline-none hover:border-ink/10 focus:border-[#3b5bdb] focus:bg-white"
                      title="标准规格（可编辑）"
                    />
                    <p className="mt-1 text-xs text-ink/50">{group.reason}</p>
                  </div>
                </div>

                {/* status actions */}
                <div className="flex shrink-0 gap-1.5">
                  {group.lineItemIds.length > 1 && (
                    <button
                      onClick={() => rejectGroup(group)}
                      className="flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent hover:bg-accent/20"
                      title="取消本组匹配，拆回为独立项目"
                    >
                      <XCircle size={12} /> 拒绝拆分
                    </button>
                  )}
                  {group.status !== "confirmed" && (
                    <button
                      onClick={() => setStatus(group.id, "confirmed")}
                      className="flex items-center gap-1 rounded-md bg-pine/10 px-2.5 py-1 text-xs font-bold text-pine hover:bg-pine/20"
                    >
                      <Check size={12} /> 确认匹配
                    </button>
                  )}
                  {group.status === "confirmed" && (
                    <button
                      onClick={() => setStatus(group.id, "possible")}
                      className="flex items-center gap-1 rounded-md bg-gold/10 px-2.5 py-1 text-xs font-bold text-gold hover:bg-gold/20"
                    >
                      <AlertTriangle size={12} /> 退回待确认
                    </button>
                  )}
                </div>
              </div>

              {/* items in group */}
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.lineItemIds.map((liId) => {
                  const item = getItem(liId);
                  const doc = getDoc(liId);
                  if (!item || !doc) return null;
                  return (
                    <div
                      key={liId}
                      className="rounded-lg border border-ink/10 bg-paper/40 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#3b5bdb]">
                          {doc.supplier.normalizedName}
                        </p>
                        {group.lineItemIds.length > 1 && (
                          <button
                            onClick={() => splitItem(group, liId)}
                            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-ink/40 hover:bg-accent/10 hover:text-accent"
                            title="将此项拆出为独立分组"
                          >
                            <Unlink size={11} /> 拆出
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-medium">{item.originalName}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
                        <span>
                          {item.quantity} {item.unit}
                        </span>
                        <span className="font-mono font-bold text-ink">
                          {fmtPrice(item.unitPrice, doc.currency ?? undefined)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* action */}
      <div className="flex justify-end">
        <Btn onClick={onContinue}>确认匹配，生成对比表 →</Btn>
      </div>
    </div>
  );
}
