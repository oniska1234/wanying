import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import FeeRulesAdmin from "@/components/my-profit/FeeRulesAdmin";

export const metadata: Metadata = {
  title: "费率管理后台",
  robots: { index: false, follow: false },
};

export default async function AdminFeeRulesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/admin/fee-rules");
  if (session.user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="text-2xl font-bold">无权访问</h1>
        <p className="mt-2 text-sm text-muted">费率管理后台仅限管理员使用。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">费率管理后台</h1>
        <p className="mt-1 text-sm text-muted">
          管理 TikTok 马来站费率规则：新建草稿、发布生效、归档回滚、CSV 批量导入与冲突检测。所有操作记录审计日志。
        </p>
      </div>
      <FeeRulesAdmin />
    </div>
  );
}
