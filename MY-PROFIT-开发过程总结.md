# MY Profit 跨境工具 — 开发过程总结

> 最后更新：2026-07-28
> 生产地址：https://47.106.167.145/tools/my-profit
> 仓库：https://github.com/oniska1234/wanying
> 服务器：47.106.167.145（阿里云）

---

## 一、项目概述

TikTok Shop 马来西亚站跨境利润选品工具（MY Profit），帮助卖家在选品阶段快速测算净利润、保本价、最高采购价，辅助选品决策。

核心功能：
- 利润计算引擎（22 个输入参数，decimal.js 4 位精度）
- 动态费率规则匹配（48 条 DB 规则，类目/店铺/BXP 三维匹配）
- 选品清单（保存/管理/状态跟踪）
- Excel 批量导入（模板下载 + 上传解析 + 批量计算保存）
- CSV 导出（Pro 功能）
- 用户系统（注册/登录/订阅/兑换码）
- 费率管理后台（Admin）

---

## 二、技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + React 19 + Tailwind 4 + TypeScript |
| 数据库 | PostgreSQL 13 |
| ORM | Prisma 6.19.3 |
| 认证 | Auth.js v5 (next-auth beta.32) + JWT + Credentials |
| 金额计算 | decimal.js（4 位精度，避免浮点误差） |
| Excel | xlsx (SheetJS) |
| 部署 | pm2 + Nginx（HTTPS 自签名证书，待 ICP 备案后切换 Let's Encrypt） |
| 备份 | pg_dump cron 每日 03:00 |

---

## 三、开发时间线

### 阶段 1：MVP 开发（2026-07-27）

| Commit | 内容 |
|---|---|
| `6d2e4af` | feat: MY Profit 全功能 MVP（计算引擎 + 费率 + 清单 + 用户 + 后台） |
| `56ae19b` | fix: trustHost 支持 Nginx 反向代理 |

### 阶段 2：IP 环境测试与修复（2026-07-27 ~ 2026-07-28）

共经历 **5 轮** IP/API 级黑盒测试：

#### 第一轮 + 第二轮（合并修复）

| Commit | 修复内容 |
|---|---|
| `c629735` | P0: HTTPS Secure Cookie、P1: 安全响应头 |

#### 第三轮

| Commit | 修复内容 |
|---|---|
| `fdb6ade` | 并发额度竞态、netMargin 溢出、求解器边界 |
| `293fadb` | FOR UPDATE → pg_advisory_xact_lock |
| `b674ba5` | $queryRaw → $executeRaw（void 反序列化） |
| `56ce00d` | Serializable → ReadCommitted + 重试逻辑 |

#### 第四轮

| Commit | 修复内容 |
|---|---|
| `c3d233e` | P0: HTTPS/Secure Cookie、P1: 安全头回归、matchLevel、PSF 日期、P2: 求解器 |

#### 第五轮（IP/API 测试通过）

| Commit | 修复内容 |
|---|---|
| `9fed4f1` | P2: matchLevel/ruleWarning 持久化 + 前端通用费率标记 |

**结论：IP/API 测试范围通过，完整浏览器验收待 ICP 备案。**

### 阶段 3：功能迭代（2026-07-28）

| Commit | 内容 |
|---|---|
| `317d78b` | feat: 计算器页面添加选品清单入口按钮 |
| `59bc693` | feat: Excel 批量导入（模板下载 + 上传解析 + 批量计算保存） |

### 阶段 4：批量导入专项测试（2026-07-28）

| Commit | 修复内容 |
|---|---|
| `edd3040` | P1: 禁止非法值静默转换 + P2: 文件级表头校验 + P2: 额度错误真实行号 |

**结论：批量导入测试通过。**

---

## 四、关键技术决策

### 4.1 并发额度控制

**问题**：免费用户最多 10 条商品，并发创建可能超出额度。

**演进**：
1. `SELECT COUNT(*) FOR UPDATE` → PostgreSQL 不支持聚合 + FOR UPDATE
2. `pg_advisory_xact_lock` + `$queryRaw` → void 类型反序列化失败
3. `pg_advisory_xact_lock` + `$executeRaw` → Serializable 隔离级别误报写冲突
4. **最终方案**：`pg_advisory_xact_lock` + `$executeRaw` + `ReadCommitted` + 重试（3 次，50ms*attempt 退避）

### 4.2 费率匹配透明度

引入 `matchLevel` 字段（exact / parent / default），让用户知道费率匹配精度：
- `exact`：精确子类目匹配
- `parent`：父类目匹配
- `default`：通用默认费率（附带 ruleWarning 提示）

### 4.3 批量导入严格校验

**原则**：解析层只做无损转换（trim、大小写归一化、数字字符串转数字），非法值必须返回行级错误，禁止兜底默认化。

校验项：
- 数量必须为正整数
- 成本币种仅 CNY/MYR
- 店铺类型仅 MARKETPLACE/MALL
- BXP 状态仅 BXP/NON_BXP/UNCERTAIN
- 商品名称不超过 100 字
- 文件扩展名 .xlsx/.xls
- 必需表头列存在

### 4.4 HTTPS 与安全

- Nginx HTTPS + 自签名证书（ICP 备案前无法使用 Let's Encrypt）
- 6 项安全响应头（HSTS、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy、CSP）
- HTTP → HTTPS 301 重定向
- Auth.js `useSecureCookies` 条件启用
- 备案后执行：`/opt/wanying/scripts/enable-letsencrypt.sh`

---

## 五、服务器部署信息

| 项目 | 值 |
|---|---|
| 服务器 | 47.106.167.145（阿里云 ECS） |
| 部署路径 | /opt/wanying |
| SSH 密钥 | ssh-1.pem |
| 数据库 | postgresql://wanying:WyDb2026!secure@127.0.0.1:5432/wanying |
| Node 版本 | 22.x |
| 进程管理 | pm2 (wanying) |
| Web 服务 | Nginx → 127.0.0.1:3000 |
| SSL 证书 | /etc/nginx/ssl/wanying.crt（自签名） |
| 环境变量 | NEXTAUTH_URL=https://47.106.167.145 |
| 费率规则 | 48 条（v2，含 PSF 2026-02-15 新费率） |

### 部署命令

```bash
cd /opt/wanying
git pull origin main
npm install
npx prisma generate
npm run build
pm2 restart wanying
# 如需重新种子费率：npx prisma db seed
```

---

## 六、API 端点清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/my-profit/products | 单条保存（服务端计算） |
| GET | /api/my-profit/products | 获取选品清单 |
| DELETE | /api/my-profit/products/[id] | 删除商品 |
| GET | /api/my-profit/products/export | CSV 导出（Pro） |
| GET | /api/my-profit/import/template | Excel 模板下载 |
| POST | /api/my-profit/import | Excel 批量导入 |
| GET | /api/my-profit/exchange-rate | 实时汇率 |
| POST | /api/auth/callback/credentials | 登录 |
| POST | /api/auth/register | 注册 |

---

## 七、测试账号

| 账号 | 密码 | 用途 |
|---|---|---|
| deploy-test@test.com | Test1234! | 部署验证 |
| qa4a@test.com | Test1234! | QA 测试 A |
| qa4b@test.com | Test1234! | QA 测试 B |

---

## 八、待办事项

| 优先级 | 事项 | 阻塞条件 |
|---|---|---|
| 高 | ICP 域名备案 | 阿里云审批流程 |
| 高 | Let's Encrypt 证书 | ICP 备案完成 |
| 高 | 浏览器 UI 完整验收 | 可信证书 |
| 中 | CSP nonce 迁移（去除 unsafe-inline） | 无 |
| 中 | Fashion/Home/Beauty L2 子类目费率 | 业务需求 |
| 低 | 移动端响应式优化 | 浏览器验收后 |
| 低 | Lighthouse 性能优化 | 浏览器验收后 |

---

## 九、文件结构（核心）

```
src/
├── app/
│   ├── api/my-profit/
│   │   ├── products/route.ts          # 单条保存 + 列表
│   │   ├── products/export/route.ts   # CSV 导出
│   │   ├── import/route.ts            # Excel 批量导入
│   │   ├── import/template/route.ts   # 模板下载
│   │   └── exchange-rate/route.ts     # 汇率
│   ├── my-profit/
│   │   ├── list/page.tsx              # 选品清单页
│   │   ├── import/page.tsx            # 批量导入页
│   │   ├── settings/page.tsx          # 用户设置
│   │   └── subscription/page.tsx      # 订阅管理
│   └── tools/[slug]/page.tsx          # 工具页（含计算器）
├── components/my-profit/
│   ├── MyProfit.tsx                   # 计算器主组件
│   ├── ProductList.tsx                # 选品清单组件
│   └── ImportPanel.tsx                # 导入面板组件
├── lib/my-profit/
│   ├── calculator.ts                  # 利润计算引擎
│   ├── fee-engine.ts                  # 费率匹配引擎
│   ├── solver.ts                      # 保本价/目标利润率求解
│   ├── scenarios.ts                   # 情景分析
│   ├── defaults.ts                    # 表单默认值 + validateForm + buildInput
│   ├── quota.ts                       # 额度管理
│   └── types.ts                       # 类型定义
└── proxy.ts                           # Middleware（路由保护）
```

---

*文档生成时间：2026-07-28 · 最终 Commit：edd3040*
