# MY Profit IP 环境第五轮测试报告

- 测试日期：2026-07-28
- 测试地址：`https://47.106.167.145/tools/my-profit`
- 测试类型：第四轮缺陷回归、核心链路复测
- 测试结论：**IP/API 测试范围通过；完整生产验收待可信证书和浏览器 UI 测试**

## 一、结论

第四轮遗留的核心问题已经修复：

- Auth.js 回调使用 HTTPS；
- Session、CSRF 和 Callback Cookie 均设置 Secure；
- 安全响应头恢复；
- 平台支持费生效日期正确；
- 目标利润售价边界正确；
- 未知类目响应包含匹配层级和风险警告。

核心能力继续保持通过：

- 服务端重新计算利润；
- 平台折扣不减少卖家收入；
- 非法输入返回结构化 400；
- 免费版并发额度无法绕过；
- 跨用户数据隔离；
- 未登录页面及 API 鉴权；
- 测试数据可完整清理。

本轮未发现新的 P0/P1 功能缺陷。

剩余事项：

1. IP 使用自签名证书，标准浏览器仍不信任；
2. 未知类目警告仅在保存 API 响应中返回，没有进入结果快照，当前前端也未展示该警告；
3. 费率类目覆盖需随业务范围继续扩充；
4. 完整 Chrome/Safari/Edge UI、移动端和下载测试仍需可信证书。

## 二、第四轮问题回归

| 第四轮问题 | 第五轮结果 |
|---|---|
| HTTPS Callback 降级 HTTP | 已修复 |
| Session Cookie 缺少 Secure | 已修复 |
| CSRF/Callback Cookie 缺少 Secure | 已修复 |
| 安全响应头消失 | 已修复 |
| 支持费生效日期错误 | 已修复 |
| 未知类目静默套用默认费率 | 部分修复：返回明确警告 |
| 目标售价边界返回空 | 已修复 |
| 费率子类目覆盖不完整 | 持续建设项 |

## 三、安全回归

### 3.1 Auth.js

登录响应：

```text
Location: https://47.106.167.145

authjs.csrf-token:
Path=/
HttpOnly
Secure
SameSite=Lax

authjs.callback-url:
Path=/
HttpOnly
Secure
SameSite=Lax

authjs.session-token:
Path=/
HttpOnly
Secure
SameSite=Lax
```

结果：通过。

### 3.2 安全响应头

当前包含：

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: ...
```

结果：通过。

当前 CSP 仍允许：

```text
'unsafe-inline'
'unsafe-eval'
```

这在 MVP 阶段可暂时接受，后续建议使用 nonce/hash 并逐步移除。

### 3.3 TLS

标准客户端结果：

```text
SSL certificate problem: self signed certificate
SSL verify result: 18
```

这是域名备案期间的已知环境限制，不计入本轮 IP/API 功能失败，但在正式对外发布前必须更换为公众信任的证书。

## 四、平台支持费

当前规则：

```text
fixedAmount: RM0.54
effectiveFrom: 2026-02-14T16:00:00Z
```

对应马来西亚时间：

```text
2026-02-15 00:00:00
```

Marketplace/Mall、BXP/非 BXP 四种组合一致。

结果：通过。

## 五、目标售价边界

测试条件：

```text
商品原价：RM100
卖家折扣：RM10
平台折扣：RM20
买家运费：RM5
商品成本：0
达人/广告：0
```

结果：

```text
总收入：RM95
净利润：RM84.551
保本售价：RM10.01
20% 目标售价：RM10.01
最高采购价：RM84.551
```

当最低合法售价已经达到目标利润时，求解器能直接返回合法下界。

结果：通过。

## 六、未知类目

请求：

```text
category: Unknown > Category
```

API 返回：

```json
{
  "ok": true,
  "matchLevel": "default",
  "warning": "该类目未找到精确费率规则，已使用通用默认费率，利润结果仅供参考"
}
```

相较第四轮，未知类目不再完全静默。

但当前仍有一个 P2 改进项：

- `matchLevel` 和警告没有持久化进计算快照；
- 前端保存成功逻辑没有展示响应中的 `warning`；
- 重新打开选品后，用户可能不知道该记录使用通用费率。

建议：

```text
resultSnapshot.matchLevel = exact | parent | default | custom
resultSnapshot.ruleWarning = ...
```

在计算结果、选品列表和导出中展示“通用费率”标记。

## 七、并发额度

使用空免费账号同时发送 20 个保存请求：

```text
HTTP 200：10
HTTP 403：10
最终商品数量：10
```

结果：通过。

## 八、权限回归

| 场景 | 结果 |
|---|---|
| 未登录访问选品清单 | 307 → 登录 |
| 未登录访问设置 | 307 → 登录 |
| 未登录访问订阅 | 307 → 登录 |
| 未登录访问管理页 | 307 → 登录 |
| 未登录读取产品 API | 401 |
| 未登录导出 API | 401 |
| 用户 B 读取用户 A 商品 | 404 |

结果：通过。

## 九、路由冒烟

| 路由 | 状态 |
|---|---:|
| `/tools/my-profit` | 200 |
| `/auth/login` | 200 |
| `/auth/register` | 200 |
| `/my-profit/list`（未登录） | 307 |
| `/my-profit/settings`（未登录） | 307 |
| `/my-profit/subscription`（未登录） | 307 |
| `/admin/my-profit`（未登录） | 307 |

结果：通过。

## 十、费率数据

当前：

- 规则数：48；
- 类目数：10；
- 佣金规则：40；
- 交易费规则：4；
- 支持费规则：4；
- 规则版本：v2；
- 未发现重复规则；
- 未发现同时缺少 rate/fixedAmount 的异常规则；
- 费率来源均指向 TikTok Shop Malaysia 官方资料。

电子类已覆盖：

- Phones & Electronics；
- Phone Accessories；
- Computers & Office；
- Automotive & Motorcycle；
- Household Appliances。

Fashion、Home & Living、Beauty 等是否需要进一步细分，应根据实际首发商品范围继续核对。

## 十一、测试数据清理

本轮创建：

- QA4A：2 条商品；
- QA4B：10 条并发额度商品。

清理结果：

```text
QA4A：删除 2，剩余 0
QA4B：删除 10，剩余 0
```

测试账号保留，账号内无选品数据。

## 十二、最终判定

### IP/API 测试

**通过。**

核心计算、服务端校验、会话配置、权限隔离、额度和规则接口满足当前 MVP 要求。

### 完整生产验收

**暂不作最终通过判定。**

等待域名备案及可信证书后补充：

1. Chrome、Safari、Edge 登录；
2. 计算器真实 UI；
3. 保存弹窗；
4. 标签和备注编辑；
5. CSV 实际下载及公式注入；
6. 360px、390px、768px 响应式；
7. 移动端键盘和滚动；
8. Lighthouse 性能；
9. CSP 浏览器控制台错误；
10. 完整 E2E 回归。

