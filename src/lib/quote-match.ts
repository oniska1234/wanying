// ============================================================
// 报价齐 · 商品匹配引擎（本地、确定性、可测试）
// ------------------------------------------------------------
// 目标：跨供应商把「同一商品」的不同表述（中 / 英 / 别名 / 近似规格）
// 归为一组，同时严格隔离「规格冲突」的不同配置（如 8GB vs 16GB、
// 512GB vs 1TB），避免把低配价误填进高配行（CASE02 危险错配）。
//
// 设计要点：
//  1. 类别同义词词典（中英双语）做主匹配信号；
//  2. 抽取「硬属性」（容量 / 颜色 / 纸张幅面 / 屏幕尺寸 / 分辨率），
//     任一硬属性冲突即判定为不同商品，绝不合并；
//  3. 用「带冲突检查的并查集」聚合，避免传递性误合并；
//  4. enforceSpecIsolation 作为安全网：对任意来源（含 AI 聚类）的分组
//     再做一次硬冲突拆分，保证规格隔离是硬约束。
// ============================================================

import type { LineItem, MatchGroup, QuoteDocument } from "./quote-types";
import { normalizeName } from "./extract/rule-provider";

// ------------------------------------------------------------
// 类别同义词词典：canonical category -> 同义词列表
//  - 纯 ASCII 词按「整词」匹配（避免 open 误命中 pen）；
//  - 含中文的词按「子串」匹配（中文无词边界）。
// ------------------------------------------------------------
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  paper: ["复印纸", "打印纸", "打印复印纸", "纸张", "paper"],
  pen: ["中性笔", "签字笔", "水笔", "圆珠笔", "走珠笔", "pen"],
  folder: ["文件夹", "资料夹", "档案夹", "folder", "binder"],
  monitor: ["显示器", "显示屏", "液晶显示器", "monitor", "display"],
  laptop: ["笔记本电脑", "笔记本", "手提电脑", "超极本", "laptop", "notebook", "thinkbook", "thinkpad", "macbook"],
  keyboard: ["键盘", "keyboard"],
  mouse: ["鼠标", "mouse"],
  router: ["路由器", "router"],
  switch_net: ["交换机", "switch"],
  cable: ["网线", "网络线", "跳线", "cable"],
  toner: ["硒鼓", "粉盒", "toner"],
  cartridge: ["墨盒", "cartridge"],
  stapler: ["订书机", "stapler"],
  paper_clip: ["回形针", "曲别针", "paperclip"],
  tape: ["胶带", "透明胶", "tape"],
};

// 颜色：中文用单字 / 双字子串，英文整词
const COLOR_SYNONYMS: Record<string, string[]> = {
  black: ["黑色", "黑", "black"],
  blue: ["蓝色", "蓝", "blue"],
  red: ["红色", "红", "red"],
  white: ["白色", "白", "white"],
  green: ["绿色", "绿", "green"],
  yellow: ["黄色", "黄", "yellow"],
  gray: ["灰色", "灰", "gray", "grey", "silver"],
};

// ------------------------------------------------------------
// 属性抽取
// ------------------------------------------------------------
export interface ItemAttrs {
  category: string | null;
  colors: Set<string>;
  /** 容量集合，如 {"16GB","512GB"} */
  caps: Set<string>;
  /** 纸张幅面，如 {"A4"} */
  paper: Set<string>;
  /** 屏幕尺寸，如 {"27"} */
  screen: Set<string>;
  /** 分辨率，如 {"4K"} */
  res: Set<string>;
}

const isAscii = (s: string) => /^[a-z0-9]+$/.test(s);

function latinTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

/** 在 name+spec 中按词典命中类别 / 颜色（中文子串 + 英文整词） */
function matchDict(
  dict: Record<string, string[]>,
  cjk: string,
  tokens: Set<string>
): Set<string> {
  const hit = new Set<string>();
  for (const [key, syns] of Object.entries(dict)) {
    for (const s of syns) {
      if (isAscii(s)) {
        if (tokens.has(s)) {
          hit.add(key);
          break;
        }
      } else if (cjk.includes(s)) {
        hit.add(key);
        break;
      }
    }
  }
  return hit;
}

export function extractAttrs(item: LineItem): ItemAttrs {
  const text = `${item.originalName} ${item.spec} ${item.brand}`;
  const cjk = normalizeName(text);
  const tokens = latinTokens(text);

  const caps = new Set<string>();
  // 兼容 "16GB"、"16G"、"1TB"、"1T"；不用 \b（CJK 边界失效），
  // 改用「后续非 ASCII 字母数字」断言；若带 B 则允许后接任意字符。
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(T|G|M)B?(?=[^a-zA-Z0-9]|$)/gi)) {
    const unit = m[2].toUpperCase() + "B"; // 统一归一为 GB / TB / MB
    caps.add(`${parseFloat(m[1])}${unit}`);
  }
  const paper = new Set<string>();
  for (const m of text.matchAll(/\b(A\d|B\d|Letter|Legal)\b/gi)) {
    paper.add(m[1].toUpperCase());
  }
  const screen = new Set<string>();
  for (const m of text.matchAll(/(\d{2}(?:\.\d+)?)\s*(?:寸|英寸|inch|"|″)(?=[^a-zA-Z0-9]|$)/gi)) {
    screen.add(m[1]);
  }
  const res = new Set<string>();
  for (const m of text.matchAll(/(4K|2K|UHD|FHD|1080P|1440P|2160P)(?=[^a-zA-Z0-9]|$)/gi)) {
    res.add(m[1].toUpperCase());
  }

  const cats = matchDict(CATEGORY_SYNONYMS, cjk, tokens);
  const colors = matchDict(COLOR_SYNONYMS, cjk, tokens);

  return {
    category: cats.size === 1 ? [...cats][0] : cats.size > 1 ? pickCategory(cats) : null,
    colors,
    caps,
    paper,
    screen,
    res,
  };
}

/** 多类别命中时取「更具体」的（词典顺序里靠前的专用类优先于泛类） */
function pickCategory(cats: Set<string>): string {
  const order = ["laptop", "monitor", "printer", "paper", "pen", "folder"];
  for (const o of order) if (cats.has(o)) return o;
  return [...cats][0];
}

// ------------------------------------------------------------
// 冲突判定
// ------------------------------------------------------------
function setConflict(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  if (a.size !== b.size) return true;
  for (const v of a) if (!b.has(v)) return true;
  return false;
}

/** 两个行项目是否存在硬属性冲突（冲突 => 必为不同商品） */
export function hardConflict(x: ItemAttrs, y: ItemAttrs): boolean {
  if (setConflict(x.caps, y.caps)) return true;
  if (setConflict(x.colors, y.colors)) return true;
  if (setConflict(x.paper, y.paper)) return true;
  if (setConflict(x.screen, y.screen)) return true;
  if (setConflict(x.res, y.res)) return true;
  return false;
}

// ------------------------------------------------------------
// 名称相似度（无类别时的兜底信号）
// ------------------------------------------------------------
function lcsLen(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

function nameSimilar(a: LineItem, b: LineItem): boolean {
  const na = normalizeName(a.originalName);
  const nb = normalizeName(b.originalName);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const lcs = lcsLen(na, nb);
  const ratio = (2 * lcs) / (na.length + nb.length);
  return ratio >= 0.8;
}

/** 判定两个行项目是否为同一商品（仅跨文档比较） */
export function sameProduct(a: LineItem, b: LineItem, ax: ItemAttrs, bx: ItemAttrs): boolean {
  if (a.docId === b.docId) return false;
  if (hardConflict(ax, bx)) return false;
  const catMatch = ax.category != null && ax.category === bx.category;
  if (catMatch) return true;
  // 双方均无类别时，用名称相似度兜底
  if (ax.category == null && bx.category == null) return nameSimilar(a, b);
  return false;
}

// ------------------------------------------------------------
// 带冲突检查的并查集
// ------------------------------------------------------------
class UF {
  parent: number[];
  members: number[][];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.members = Array.from({ length: n }, (_, i) => [i]);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  /** 合并两个集合；若合并后内部存在硬冲突则拒绝（返回 false） */
  union(i: number, j: number, attrs: ItemAttrs[]): boolean {
    const ri = this.find(i);
    const rj = this.find(j);
    if (ri === rj) return true;
    for (const mi of this.members[ri]) {
      for (const mj of this.members[rj]) {
        if (hardConflict(attrs[mi], attrs[mj])) return false;
      }
    }
    this.parent[rj] = ri;
    this.members[ri] = this.members[ri].concat(this.members[rj]);
    this.members[rj] = [];
    return true;
  }
}

// ------------------------------------------------------------
// 分组构建
// ------------------------------------------------------------
function representativeName(items: LineItem[]): string {
  // 优先含中文的名称，其次最短（更精炼）
  const withCjk = items.find((i) => /[\u4e00-\u9fa5]/.test(i.originalName));
  if (withCjk) return withCjk.originalName;
  return [...items].sort((a, b) => a.originalName.length - b.originalName.length)[0]
    .originalName;
}

function buildGroupFromMembers(
  members: LineItem[],
  analyzedDocCount: number,
  idx: number
): MatchGroup {
  const distinctDocs = new Set(members.map((m) => m.docId));
  let status: MatchGroup["status"];
  if (members.length === 1) status = "unique";
  else if (distinctDocs.size >= analyzedDocCount) status = "confirmed";
  else status = "possible";
  const specs = Array.from(new Set(members.map((m) => m.spec).filter(Boolean)));
  return {
    id: `mg-${idx}`,
    normalizedName: representativeName(members),
    normalizedSpec: specs.join(" / "),
    status,
    reason:
      status === "unique"
        ? "仅一家供应商报价包含此项"
        : status === "confirmed"
          ? "各供应商均包含此项，已按类别与规格自动归组"
          : "部分供应商缺失或规格存在差异，需人工确认",
    lineItemIds: members.map((m) => m.id),
    userConfirmed: false,
  };
}

/** 本地确定性匹配：跨供应商归组，硬冲突隔离 */
export function buildMatchGroupsLocal(documents: QuoteDocument[]): MatchGroup[] {
  const analyzed = documents.filter((d) => d.analyzed !== false);
  const items = analyzed.flatMap((d) => d.lineItems);
  const attrs = items.map(extractAttrs);
  const uf = new UF(items.length);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (sameProduct(items[i], items[j], attrs[i], attrs[j])) {
        uf.union(i, j, attrs);
      }
    }
  }

  const seen = new Set<number>();
  const groups: MatchGroup[] = [];
  let idx = 0;
  for (let i = 0; i < items.length; i++) {
    const r = uf.find(i);
    if (seen.has(r)) continue;
    seen.add(r);
    idx++;
    const members = uf.members[r].map((k) => items[k]);
    groups.push(buildGroupFromMembers(members, analyzed.length, idx));
  }
  return groups;
}

// ------------------------------------------------------------
// 由外部聚类结果（如 AI 聚类）构建分组
// ------------------------------------------------------------
/**
 * 将「行项目 id 聚类」转为 MatchGroup[]（状态 / 代表名 / 规格自动推导）。
 * 供 AI 聚类等外部匹配结果复用，随后仍应经 enforceSpecIsolation 校验。
 */
export function groupsFromClusters(
  documents: QuoteDocument[],
  clusters: string[][]
): MatchGroup[] {
  const itemById = new Map<string, LineItem>();
  for (const d of documents) for (const li of d.lineItems) itemById.set(li.id, li);
  const analyzed = documents.filter((d) => d.analyzed !== false).length;
  const groups: MatchGroup[] = [];
  let idx = 0;
  for (const ids of clusters) {
    const members = ids
      .map((id) => itemById.get(id))
      .filter((x): x is LineItem => Boolean(x));
    if (members.length === 0) continue;
    idx++;
    groups.push(buildGroupFromMembers(members, analyzed, idx));
  }
  return groups;
}

// ------------------------------------------------------------
// 规格隔离安全网（对任意来源分组再校验，含 AI 聚类结果）
// ------------------------------------------------------------
/** 将组内存在硬冲突的成员拆分为多个子组，保证组内规格自洽 */
export function enforceSpecIsolation(
  groups: MatchGroup[],
  documents: QuoteDocument[]
): MatchGroup[] {
  const itemById = new Map<string, LineItem>();
  for (const d of documents) for (const li of d.lineItems) itemById.set(li.id, li);
  const analyzed = documents.filter((d) => d.analyzed !== false).length;

  const out: MatchGroup[] = [];
  let idx = 0;
  for (const g of groups) {
    const members = g.lineItemIds
      .map((id) => itemById.get(id))
      .filter((x): x is LineItem => Boolean(x));
    const attrs = members.map(extractAttrs);
    // 贪心分簇：簇内不得有硬冲突
    const clusters: number[][] = [];
    for (let i = 0; i < members.length; i++) {
      let placed = false;
      for (const c of clusters) {
        if (!c.some((k) => hardConflict(attrs[k], attrs[i]))) {
          c.push(i);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([i]);
    }
    if (clusters.length === 1) {
      idx++;
      out.push({ ...g, id: `mg-${idx}` });
    } else {
      for (const c of clusters) {
        idx++;
        const sub = c.map((k) => members[k]);
        const ng = buildGroupFromMembers(sub, analyzed, idx);
        ng.userConfirmed = g.userConfirmed;
        if (clusters.length > 1) {
          ng.reason = g.userConfirmed
            ? "人工分组经规格隔离校验后拆分"
            : "检测到规格冲突，已自动隔离为独立分组（避免错配）";
        }
        out.push(ng);
      }
    }
  }
  return out;
}
