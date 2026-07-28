# MY Profit 跨境工具 MVP — 开发完成报告

> 完成时间：2026-07-27  
> 生产地址：http://47.106.167.145/tools/my-profit  
> Git 提交：`6d2e4af` (feat) → `56ae19b` (fix: trustHost)  
> 仓库：https://github.com/oniska1234/wanying

---

## 概述

在万应站点（Next.js 16）新增「跨境工具」频道，首个工具为 **TikTok Shop 马来站利润选品工具（MY Profit）**。包含：利润计算引擎、动态费率规则、汇率服务、多 SKU、选品清单、账号与订阅、费率管理后台。

**9 个阶段全部实现、验证并部署至生产服务器。**

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16.2.12 + React 19 + Tailwind 4 |
| 数据库 | PostgreSQL 13 (wanying 服务器) |
| ORM | Prisma 6.19.3 |
| 认证 | Auth.js v5 (next-auth beta.32) + JWT |
| 金额计算 | decimal.js (4 位精度) |
| 部署 | pm2 + Nginx |
| 备份 | pg_dump cron 每日 03:00 |

---

## 阶段完成情况

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 基础设施与数据层 (PG + Prisma 12 模型 + 频道注册) | ✅ |
| 2 | 计算引擎 (calculator/solver/scenarios/fee-engine, 132 测试) | ✅ |
| 3 | 费率数据与汇率 (20 条种子规则 + 实时汇率 API) | ✅ |
| 4 | 认证与账号 (Auth.js 邮箱密码 + JWT + 路由保护 + 设置) | ✅ |
| 5 | 计算器前端 (桌面/移动布局 + 多 SKU + 情景对比) | ✅ |
| 6 | 选品清单 (CRUD/状态/标签/批量删除/HMAC CSV 导出) | ✅ |
| 7 | 订阅与额度 (免费版限额 + 兑换码开通 Pro) | ✅ |
| 8 | 费率管理后台 (CRUD/发布/CSV 导入/冲突检测/审计) | ✅ |
| 9 | SEO 合规与上线 (JSON-LD + 隐私政策 + 备份 + 部署) | ✅ |

---

## 关键文件清单

### 计算引擎 (纯函数)
- `src/lib/my-profit/types.ts` — 类型定义
- `src/lib/my-profit/fee-engine.ts` — 费率规则匹配
- `src/lib/my-profit/calculator.ts` — 利润计算
- `src/lib/my-profit/solver.ts` — 保本价二分求解
- `src/lib/my-profit/scenarios.ts` — 乐观/正常/悲观情景
- `src/lib/my-profit/engine.test.ts` — 24 个单元测试

### API 路由
- `src/app/api/my-profit/fee-rules/route.ts` — 费率查询
- `src/app/api/my-profit/exchange-rate/route.ts` — 汇率 (实时+缓存降级)
- `src/app/api/my-profit/products/route.ts` — 选品 CRUD
- `src/app/api/my-profit/products/[id]/route.ts` — 单品操作
- `src/app/api/my-profit/products/batch-delete/route.ts` — 批量删除
- `src/app/api/my-profit/products/export/route.ts` — CSV 导出
- `src/app/api/my-profit/redeem/route.ts` — 兑换码
- `src/app/api/my-profit/settings/route.ts` — 用户设置
- `src/app/api/my-profit/admin/fee-rules/route.ts` — 管理后台
- `src/app/api/my-profit/admin/fee-rules/[id]/route.ts` — 发布/归档
- `src/app/api/my-profit/admin/fee-rules/import/route.ts` — CSV 导入
- `src/app/api/auth/register/route.ts` — 注册
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js

### 前端组件
- `src/components/my-profit/MyProfit.tsx` — 计算器主组件
- `src/components/my-profit/ProductList.tsx` — 选品清单 UI
- `src/components/my-profit/SubscriptionForm.tsx` — 订阅页
- `src/components/my-profit/SettingsForm.tsx` — 用户设置
- `src/components/my-profit/FeeRulesAdmin.tsx` — 管理后台 UI
- `src/components/Providers.tsx` — SessionProvider
- `src/components/Header.tsx` — 导航 + 用户菜单

### 页面路由
- `src/app/tools/[slug]/page.tsx` — 工具页 (含 SEO + JSON-LD)
- `src/app/my-profit/list/page.tsx` — 选品清单
- `src/app/my-profit/subscription/page.tsx` — 会员订阅
- `src/app/my-profit/settings/page.tsx` — 用户设置
- `src/app/admin/fee-rules/page.tsx` — 管理后台
- `src/app/auth/login/page.tsx` — 登录
- `src/app/auth/register/page.tsx` — 注册
- `src/app/privacy/page.tsx` — 隐私政策
- `src/app/error.tsx` — 全局错误边界

### 基础设施
- `src/lib/auth.ts` — Auth.js 配置 (trustHost: true)
- `src/lib/prisma.ts` — Prisma 单例
- `src/lib/my-profit/quota.ts` — 额度校验
- `src/lib/my-profit/admin.ts` — 管理权限 + 审计 + 冲突检测
- `src/lib/my-profit/export-token.ts` — HMAC 签名导出令牌
- `src/proxy.ts` — 路由保护 (edge middleware)
- `prisma/schema.prisma` — 数据模型
- `prisma/seed.ts` — 费率种子数据

---

## 验证证据

### 本地验证
| 检查项 | 结果 |
|--------|------|
| tsc --noEmit | EXIT 0 |
| vitest run | 132 passed, 1 skipped |
| next build | 31 路由全部编译通过 |

### 生产验证 (curl)
| 检查项 | 结果 |
|--------|------|
| 公开页面 /, /tools/my-profit, /privacy | HTTP 200 |
| 路由保护 /my-profit/list (无登录) | 307 → /auth/login |
| 费率 API | 17 条规则返回 |
| 汇率 API | 实时 1.6591 (open.er-api.com) |
| 注册 → CSRF → 登录 → Session | session 含 id + role |
| 兑换码 WANYING-PRO-2026 | 升级 Pro |
| 兑换码重复使用 | 409 已使用 |
| 保存商品 (登录态) | ok + DB 写入 |
| 管理员列表/创建/发布/归档 | 全部成功 |
| 非管理员访问 admin API | 403 |

### 生产验证 (浏览器)
- 计算器页面完整渲染 (22 个输入控件 + 立即计算按钮)
- 点击「立即计算」后结果区渲染：
  - 情景分析：乐观 RM18.27 / 正常 RM13.73 / 悲观 RM8.28
  - 退款风险：单笔全额退款损失 RM34.69
  - 免责声明文案
- SEO title: 「马来站利润测算 - MY Profit 免费在线工具 · 万应」
- JSON-LD 结构化数据存在
- 首页导航含「跨境工具」频道

### 数据库状态 (生产)
| 表 | 行数 |
|----|------|
| FeeRule | 22 |
| User | 5 |
| Subscription | 5 |
| Product | 2 |
| AuditLog | 7 |
| ExchangeRate | 9 |

---

## 部署与运维

### 服务器环境 (.env.local)
```
DASHSCOPE_API_KEY=***
DATABASE_URL=postgresql://wanying:***@127.0.0.1:5432/wanying
AUTH_SECRET=***(openssl rand -base64 32 生成)
NEXTAUTH_URL=http://47.106.167.145
NEXT_PUBLIC_SITE_URL=http://47.106.167.145
REDEEM_CODES=WANYING-PRO-2026,VIP888
```

### 部署流程
```bash
# 服务器 /opt/wanying/deploy.sh
git pull origin main
npm install --production=false
npx prisma generate
npm run build
pm2 restart wanying
```

### 数据库备份
- 脚本：`/opt/wanying/scripts/db-backup.sh`
- 方式：`pg_dump -Fc` + gzip
- 保留：14 天自动清理
- 频率：cron 每日 03:00
- 备份目录：`/opt/wanying/backups/`

### 修复记录
- **UntrustedHost 错误**：首次部署后 Auth.js 在 Nginx 反代场景下抛出 UntrustedHost。修复：`src/lib/auth.ts` 添加 `trustHost: true`，重新部署后 csrf/session/login 全部正常。

---

## 兑换码 (MVP 阶段)
- `WANYING-PRO-2026` — 已使用
- `VIP888` — 可用

---

## 后续可扩展方向
1. 接入真实支付 (Stripe/支付宝) 替代兑换码
2. 更多站点费率 (泰国/越南/菲律宾)
3. 成本模板保存与复用
4. 费率自动爬取与更新提醒
5. 数据看板 (历史利润趋势)
6. HTTPS 证书配置 (Let's Encrypt)
