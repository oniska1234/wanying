"use client";

import { useState } from "react";
import { Loader2, RotateCcw, FlaskConical } from "lucide-react";
import { buildDemoProject } from "@/lib/quote-mock";
import { extractProject } from "@/lib/extract-client";
import { detectAnomalies } from "@/lib/quote-utils";
import type {
  ComparisonProject,
  QuoteDocument,
  LineItem,
  MatchGroup,
  UploadFile,
} from "@/lib/quote-types";
import StepIndicator from "@/components/quote/StepIndicator";
import UploadZone from "@/components/quote/UploadZone";
import QualityCheck from "@/components/quote/QualityCheck";
import ExtractionReview from "@/components/quote/ExtractionReview";
import MatchReview from "@/components/quote/MatchReview";
import ComparisonTable from "@/components/quote/ComparisonTable";
import ExportPanel from "@/components/quote/ExportPanel";

type TaxMode = "original" | "inclusive" | "exclusive";

export default function QuoteComparePage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("正在解析报价文件…");
  const [project, setProject] = useState<ComparisonProject | null>(null);

  // 真实抽取：上传文件 → /api/extract 服务端解析 → 结构化项目
  // 失败时回退到演示模式，保证流程仍可继续（并显示演示横幅）
  const processFiles = async (files: UploadFile[], providerId: string) => {
    setLoading(true);
    setLoadingMsg(
      providerId === "bailian"
        ? "百炼 AI 正在智能解析报价文件…"
        : "正在解析报价文件…"
    );
    try {
      const proj = await extractProject(files, providerId);
      setProject(proj);
    } catch (e) {
      console.error("[quote-compare] 抽取失败，回退演示模式：", e);
      setProject(buildDemoProject(files));
    } finally {
      setStep(1);
      setLoading(false);
    }
  };

  const handleUploadComplete = (files: UploadFile[], providerId: string) => {
    void processFiles(files, providerId);
  };

  // ---- 单一数据源更新器（异常随文档变化自动重算） ----
  const recompute = (next: ComparisonProject): ComparisonProject => ({
    ...next,
    anomalies: detectAnomalies(next),
  });

  const updateDocument = (docId: string, patch: Partial<QuoteDocument>) => {
    setProject((prev) => {
      if (!prev) return prev;
      const documents = prev.documents.map((d) =>
        d.id === docId ? { ...d, ...patch } : d
      );
      return recompute({ ...prev, documents });
    });
  };

  const updateLineItem = (
    docId: string,
    itemId: string,
    patch: Partial<LineItem>
  ) => {
    setProject((prev) => {
      if (!prev) return prev;
      const documents = prev.documents.map((d) => {
        if (d.id !== docId) return d;
        const lineItems = d.lineItems.map((li) =>
          li.id === itemId ? { ...li, ...patch } : li
        );
        return { ...d, lineItems };
      });
      return recompute({ ...prev, documents });
    });
  };

  const updateMatchGroups = (matchGroups: MatchGroup[]) => {
    setProject((prev) => (prev ? { ...prev, matchGroups } : prev));
  };

  const setCaliber = (taxMode: TaxMode, includeShipping: boolean) => {
    setProject((prev) => (prev ? { ...prev, taxMode, includeShipping } : prev));
  };

  // ---- 多币种汇率（P0-02）：未确认前跨币种不可比 ----
  const updateExchangeRate = (
    currency: string,
    patch: Partial<{ rate: number; confirmed: boolean; date: string; source: string }>
  ) => {
    setProject((prev) => {
      if (!prev) return prev;
      const cur = currency.toUpperCase();
      const prevRates = prev.exchangeRates ?? {};
      const existing = prevRates[cur] ?? { rate: 0, confirmed: false };
      return {
        ...prev,
        exchangeRates: {
          ...prevRates,
          [cur]: { ...existing, ...patch },
        },
      };
    });
  };

  const setBaseCurrency = (baseCurrency: string) => {
    setProject((prev) =>
      prev
        ? { ...prev, baseCurrency: baseCurrency.toUpperCase(), currency: baseCurrency.toUpperCase() }
        : prev
    );
  };

  const handleQualityContinue = () => setStep(2);
  const handleExtractionContinue = () => setStep(3);
  const handleMatchContinue = () => setStep(4);
  const handleCompareContinue = () => setStep(5);

  const reset = () => {
    setStep(0);
    setProject(null);
    setLoading(false);
  };

  const analyzedDocs = project
    ? project.documents.filter((d) => d.analyzed !== false)
    : [];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      {/* header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#3b5bdb] font-display text-sm text-white">
              齐
            </span>
            报价齐
          </h1>
          <p className="mt-1 text-sm text-muted">
            AI 多报价单整理与对比助手 · 上传报价，生成可追溯对比表
          </p>
        </div>
        {step > 0 && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-ink/5"
          >
            <RotateCcw size={13} /> 重新开始
          </button>
        )}
      </div>

      {/* demo mode banner */}
      {project?.demoMode && step > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          <FlaskConical size={16} className="mt-0.5 shrink-0" />
          <p>
            <span className="font-bold">演示模式</span>
            ：文件身份（名称 / 大小 / 类型 / 质量）来自您的真实上传；抽取与匹配结果为内置示例数据，
            用于演示完整流程，<span className="font-bold">并非对您文件的真实 AI 分析</span>
            。接入 AI 服务后即可输出真实结果。
          </p>
        </div>
      )}

      {/* step indicator */}
      {step > 0 && (
        <div className="mb-6">
          <StepIndicator current={step} onStepClick={setStep} />
        </div>
      )}

      {/* loading overlay */}
      {loading && (
        <div className="grid place-items-center py-20">
          <Loader2 size={36} className="animate-spin text-[#3b5bdb]" />
          <p className="mt-4 text-sm text-muted">{loadingMsg}</p>
        </div>
      )}

      {/* step content */}
      {!loading && (
        <>
          {step === 0 && <UploadZone onComplete={handleUploadComplete} />}

          {step === 1 && project && (
            <QualityCheck
              documents={project.documents}
              onContinue={handleQualityContinue}
            />
          )}

          {step === 2 && project && (
            <ExtractionReview
              documents={analyzedDocs}
              onUpdateDocument={updateDocument}
              onUpdateLineItem={updateLineItem}
              onContinue={handleExtractionContinue}
            />
          )}

          {step === 3 && project && (
            <MatchReview
              project={project}
              onUpdateGroups={updateMatchGroups}
              onContinue={handleMatchContinue}
            />
          )}

          {step === 4 && project && (
            <div className="space-y-5">
              <ComparisonTable
                project={project}
                onCaliberChange={setCaliber}
                onUpdateRate={updateExchangeRate}
                onBaseCurrencyChange={setBaseCurrency}
              />
              <div className="flex justify-end">
                <button
                  onClick={handleCompareContinue}
                  className="rounded-lg bg-[#3b5bdb] px-5 py-2.5 text-sm font-bold text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)] transition-all hover:-translate-y-0.5"
                >
                  确认对比，导出结果 →
                </button>
              </div>
            </div>
          )}

          {step === 5 && project && <ExportPanel project={project} />}
        </>
      )}
    </div>
  );
}
