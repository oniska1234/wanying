// ============================================================
// 报价齐 · 抽取框架入口（提供器注册表 + 编排）
// ============================================================

import type { QuoteDocument } from "../quote-types";
import type { ExtractionInput, ExtractionProvider } from "./types";
import { ruleProvider } from "./rule-provider";
import { bailianProvider } from "./ai-provider";

/** 提供器注册表：新增提供器在此登记即可被 API / 前端选用 */
const registry: Record<string, ExtractionProvider> = {
  [ruleProvider.id]: ruleProvider,
  [bailianProvider.id]: bailianProvider,
};

export const DEFAULT_PROVIDER_ID = ruleProvider.id;

export function getProvider(id: string | null | undefined): ExtractionProvider {
  return registry[id ?? DEFAULT_PROVIDER_ID] ?? ruleProvider;
}

export function listProviders(): ExtractionProvider[] {
  return Object.values(registry);
}

/**
 * 对一组文件执行抽取，分配 id / projectId，并修正行项目与证据的关联 id。
 * 单个文件解析失败不会中断整体，由提供器内部降级为质量检查文档。
 */
export async function runExtraction(
  inputs: ExtractionInput[],
  providerId: string | null | undefined,
  projectId: string
): Promise<QuoteDocument[]> {
  const provider = getProvider(providerId);
  const documents: QuoteDocument[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const docId = `doc-${i + 1}`;
    const result = await provider.extract(inputs[i]);
    const draft = result.document;

    // 修正行项目 docId 与证据 fileId 指向真实文档 id；
    // 关键：用 docId 为行项目 id 加命名空间，保证跨文档全局唯一。
    // 否则各提供器生成的 li-1/li-2 会在多文档间碰撞，导致匹配组、
    // 横向对比与人工合并按 id 取数时串到其它供应商（P0-01 根因）。
    const lineItems = draft.lineItems.map((li) => ({
      ...li,
      id: `${docId}-${li.id}`,
      docId,
      evidence: li.evidence.map((ev) => ({ ...ev, fileId: docId })),
    }));

    documents.push({
      ...draft,
      id: docId,
      projectId,
      supplier: { ...draft.supplier, id: `sup-${i + 1}` },
      lineItems,
    });
  }

  return documents;
}

export type { ExtractionInput, ExtractionProvider } from "./types";
export type { DraftDocument, ExtractionResult } from "./types";
