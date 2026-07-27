import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlan } from "@/lib/my-profit/quota";
import SubscriptionForm from "@/components/my-profit/SubscriptionForm";

export const metadata: Metadata = {
  title: "会员订阅",
  robots: { index: false, follow: false },
};

export default async function SubscriptionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/my-profit/subscription");

  const plan = await getPlan(session.user.id);
  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true },
  });

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold">会员订阅</h1>
        <p className="mt-1 text-sm text-muted">选择适合你的方案，解锁完整选品能力。</p>
      </div>
      <SubscriptionForm plan={plan} expiresAt={sub?.expiresAt ? sub.expiresAt.toISOString() : null} />
    </div>
  );
}
