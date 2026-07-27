import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import SettingsForm from "@/components/my-profit/SettingsForm";

export const metadata: Metadata = {
  title: "用户设置",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/my-profit/settings");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      defaultCurrency: true,
      defaultShopType: true,
      locale: true,
    },
  });
  if (!user) redirect("/auth/login?callbackUrl=/my-profit/settings");

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">用户设置</h1>
        <p className="mt-1 text-sm text-muted">配置默认币种、店铺类型等偏好，计算时自动套用。</p>
      </div>
      <div className="rounded-2xl border border-ink/10 bg-card p-6 sm:p-8">
        <SettingsForm initial={user} />
      </div>
    </div>
  );
}
