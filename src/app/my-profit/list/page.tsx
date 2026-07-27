import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { checkQuota } from "@/lib/my-profit/quota";
import ProductList from "@/components/my-profit/ProductList";

export const metadata: Metadata = {
  title: "选品清单",
  robots: { index: false, follow: false },
};

export default async function ListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/my-profit/list");

  const quota = await checkQuota(session.user.id);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">选品清单</h1>
          <p className="mt-1 text-sm text-muted">管理已保存的利润测算快照，跟踪选品决策状态。</p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-card px-3 py-2 text-xs">
          {quota.plan === "PRO" ? (
            <span className="font-semibold text-accent">Pro · 无限选品</span>
          ) : (
            <span className="text-ink/60">
              免费版 · 已保存 <b>{quota.productCount}</b> / {quota.maxProducts}
            </span>
          )}
        </div>
      </div>

      {quota.plan === "FREE" && !quota.canSave && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          免费版选品名额已满（{quota.maxProducts} 个）。升级 Pro 解锁无限选品、CSV 导出与完整情景分析。
        </p>
      )}

      <ProductList plan={quota.plan} />
    </div>
  );
}
