// ============================================================
// 报价齐 · 可插拔抽取框架 · 类型定义
// ------------------------------------------------------------
// 设计目标：
//  1. 抽取能力以「提供器（Provider）」为单位抽象，默认走本地规则解析，
//     可平滑替换为任意大模型（如阿里云百炼 qwen-vl）。
//  2. 提供器与服务端解耦：需要密钥 / 大算力的提供器标记 serverOnly。
//  3. 输入为原始字节，输出为结构化报价单草稿（id/projectId 由编排层填充）。
// ============================================================

import type { FileType, QuoteDocument } from "../quote-types";

/** 抽取提供器接收的单个文件输入 */
export interface ExtractionInput {
  fileName: string;
  fileType: FileType;
  fileSize: number;
  /** 原始字节 */
  data: Uint8Array;
}

/**
 * 报价单草稿：结构化抽取结果。
 * id / projectId 由编排层（runExtraction / API route）统一分配。
 */
export type DraftDocument = Omit<QuoteDocument, "id" | "projectId">;

/** 抽取提供器输出 */
export interface ExtractionResult {
  document: DraftDocument;
  /** 原始解析文本（用于证据锚点 / 调试） */
  rawText?: string;
  /** 实际使用的提供器 id */
  providerId: string;
  /** 是否真实解析了文件内容（false 表示仅质量检查 / 回退） */
  parsed: boolean;
}

/** 抽取提供器接口 */
export interface ExtractionProvider {
  /** 唯一标识，如 "rule" | "bailian" */
  readonly id: string;
  /** 展示名称 */
  readonly label: string;
  /** 能力描述 */
  readonly description: string;
  /** 是否仅可在服务端运行（如需密钥 / 大模型算力） */
  readonly serverOnly: boolean;
  /** 执行抽取 */
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
