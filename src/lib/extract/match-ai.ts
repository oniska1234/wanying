// ============================================================
// 报价齐 · AI 辅助匹配聚类（百炼 qwen，仅文本调用）
// ------------------------------------------------------------
// 当使用百炼 AI 抽取时，额外发起一次「轻量文本」调用，把各供应商
// 已抽取的行项目（名称 / 规格 / 品牌）交给模型做跨供应商同义归组，
// 以稳健处理中 / 英 / 别名等同义词（本地词典的补充）。
// 注意：
//  - 不重新上传文件，仅发送结构化字段，成本低、速度快；
//  - 任何失败均回退本地匹配（返回 null）；
//  - 返回结果仍会经 enforceSpecIsolation 做硬冲突隔离，
//    因此即便模型误合并 8GB/16GB，也会被安全网拆回。
// ============================================================

import type { MatchGroup, QuoteDocument } from "../quote-types";
import { groupsFromClusters } from "../quote-match";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen-plus";
const TIMEOUT_MS = 60_000;

function baseUrl(): string {
  return (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
function model(): string {
  return process.env.BAILIAN_MATCH_MODEL || process.env.BAILIAN_MODEL || DEFAULT_MODEL;
}

interface FlatItem {
  idx: number;
  id: string;
  supplier: string;
  name: string;
  spec: string;
  brand: string;
}

const PROMPT = [
  "你是采购报价比对专家。下面给出多家供应商报价的行项目列表，每项有 idx、supplier、name、spec、brand。",
  "请把「同一商品」的不同表述（中文名 / 英文名 / 别名 / 近义词）归为一组，输出 JSON。",
  "严格规则：",
  "1. 仅当商品本质相同才归组；不同规格 / 配置必须分开，例如 8GB 与 16GB、512GB 与 1TB、不同颜色、不同尺寸不得同组。",
  "2. 同一供应商的多个不同商品不得同组。",
  "3. 每个 idx 必须且只能出现在一个组里；无法与任何项归组的，单独成一组。",
  "4. 只输出 JSON，形如 {\"groups\":[[0,3,6],[1,4,7],[2,5,8]]}，不要任何解释或代码块。",
].join("\n");

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
}

/** 最佳努力：用 AI 对行项目做跨供应商聚类；失败返回 null（由调用方回退本地匹配） */
export async function clusterItemsWithAi(
  documents: QuoteDocument[],
  apiKey: string
): Promise<MatchGroup[] | null> {
  const analyzed = documents.filter((d) => d.analyzed !== false);
  const flat: FlatItem[] = [];
  for (const d of analyzed) {
    for (const li of d.lineItems) {
      flat.push({
        idx: flat.length,
        id: li.id,
        supplier: d.supplier.normalizedName,
        name: li.originalName,
        spec: li.spec,
        brand: li.brand,
      });
    }
  }
  if (flat.length < 2) return null;

  try {
    const res = await fetchWithTimeout(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: JSON.stringify(flat) },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;

    const stripped = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as { groups?: unknown };
    const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : null;
    if (!rawGroups) return null;

    // idx -> id；去重 + 覆盖检查
    const used = new Set<number>();
    const clusters: string[][] = [];
    for (const g of rawGroups) {
      if (!Array.isArray(g)) continue;
      const ids: string[] = [];
      for (const v of g) {
        const n = typeof v === "number" ? v : parseInt(String(v), 10);
        if (!Number.isFinite(n) || n < 0 || n >= flat.length || used.has(n)) continue;
        used.add(n);
        ids.push(flat[n].id);
      }
      if (ids.length > 0) clusters.push(ids);
    }
    // 未被归组的项各自成组
    for (const it of flat) {
      if (!used.has(it.idx)) clusters.push([it.id]);
    }

    return groupsFromClusters(analyzed, clusters);
  } catch {
    return null;
  }
}
