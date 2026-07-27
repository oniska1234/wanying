import type { Metadata } from "next";
import Link from "next/link";
import { getSiteUrl, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "隐私政策",
  description: `${SITE_NAME} 隐私政策：我们如何收集、使用与保护你的信息。`,
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "一、我们收集的信息",
    p: [
      "账号信息：当你注册账号时，我们收集你的邮箱地址与加密后的密码，用于登录与身份验证。",
      "用户设置：你主动填写的默认币种、店铺类型、昵称等偏好设置。",
      "选品数据：你保存的商品名称、成本参数、利润计算快照与备注标签等，仅用于为你提供选品清单服务。",
      "使用日志：基础的访问与错误日志，用于保障服务稳定与安全。",
    ],
  },
  {
    h: "二、我们如何使用信息",
    p: [
      "提供、维护和改进工具服务（如利润计算、选品清单、费率管理）。",
      "在你登录时验证身份，保护账号安全。",
      "排查故障、监控错误，提升服务可靠性。",
      "我们不会出售你的个人信息，不会将其用于与服务无关的用途。",
    ],
  },
  {
    h: "三、本地计算与数据边界",
    p: [
      "多数工具（如 JSON 格式化、Base64 等）完全在你的浏览器本地运行，数据不会上传到服务器。",
      "利润测算工具的计算在浏览器本地完成；仅当你主动「保存到选品清单」时，相关快照才会加密存储到我们的服务器。",
      "AI 增强功能（如报价对比的智能抽取）需经服务端调用模型服务，使用前会明确告知并征得你的同意。",
    ],
  },
  {
    h: "四、Cookie 与会话",
    p: [
      "我们使用必要的 Cookie（会话令牌）来保持你的登录状态。这些 Cookie 为服务正常运行所必需，不用于广告追踪。",
    ],
  },
  {
    h: "五、数据安全",
    p: [
      "密码使用 bcrypt 加密存储，传输过程采用 HTTPS 加密。",
      "数据库每日自动备份，并采取访问控制措施保护你的数据。",
      "尽管我们尽力保护，但没有任何方法能保证 100% 安全，请妥善保管你的账号密码。",
    ],
  },
  {
    h: "六、你的权利",
    p: [
      "你可以随时在「用户设置」中修改你的偏好，或删除你保存的选品数据。",
      "如需注销账号或删除全部数据，可通过站点公布的联系方式与我们联系，我们将在合理期限内处理。",
    ],
  },
  {
    h: "七、免责声明",
    p: [
      "本工具提供的利润测算结果仅供参考，不构成任何经营、投资或财务建议。",
      "平台费率、汇率等数据可能存在更新延迟或误差，请以 TikTok Shop 官方及实际交易为准。",
      "因使用本工具结果进行经营决策所产生的任何后果，由使用者自行承担。",
    ],
  },
  {
    h: "八、政策更新",
    p: [
      "我们可能不时更新本政策，更新后会在本页面公布。继续使用本服务即表示你接受更新后的政策。",
    ],
  },
];

export default function PrivacyPage() {
  const url = getSiteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "隐私政策",
    url: `${url}/privacy`,
    inLanguage: "zh-CN",
  };
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="text-3xl font-bold">隐私政策</h1>
      <p className="mt-2 text-sm text-muted">
        最后更新：2026 年 · 本政策说明 {SITE_NAME}（{url}）如何收集、使用与保护你的信息。
      </p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-bold">{s.h}</h2>
            <div className="mt-2 space-y-2">
              {s.p.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-ink/75">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-sm text-muted">
        返回 <Link href="/" className="font-semibold text-accent hover:underline">首页</Link>
      </p>
    </div>
  );
}
