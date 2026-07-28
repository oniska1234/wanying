import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import ImportPanel from "@/components/my-profit/ImportPanel";

export const metadata: Metadata = {
  title: "批量导入",
  robots: { index: false, follow: false },
};

export default async function ImportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/my-profit/import");

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Excel 批量导入</h1>
        <p className="mt-1 text-sm text-muted">
          下载模板 → 线下填写多商品数据 → 上传 Excel 批量计算并保存到选品清单
        </p>
      </div>
      <ImportPanel />
    </div>
  );
}
