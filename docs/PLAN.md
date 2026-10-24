# TokenExchange 实施计划

> 目标：自研一个"批发上游 token → 加价卖给下游"的平台，部署在 Vercel。
> 面向海外市场，用 Stripe 收款，三种上游来源（官方 / 云厂商 / 转售商）都接，后台可选。

## 0. 已定决策

| 决策 | 结论 |
|---|---|
| 代码来源 | **独立实现**，只依据 OpenAI、Anthropic、AWS、Google 的公开 API 文档编写，不复制、不改写 new-api / one-api 代码。因此不受 AGPL 和署名条款约束，许可证可以自选 |
| 市场 / 支付 | 海外，Stripe |
| 上游来源 | official（OpenAI、Anthropic、Gemini）+ cloud（Azure OpenAI、Bedrock、Vertex）+ reseller（OpenAI / Anthropic 兼容中转），后台可以按来源整体开关，也可以按模型限定 |
| 部署 | Vercel（Next.js 函数）+ Postgres（Neon 或 Supabase） |

> 注意：照着 new-api 源码逐段"重写"，法律上仍算衍生作品。今后开发也请保持这条边界：可以参考它的功能设计，不要参考它的代码。

## 1. 架构

```
客户 SDK / Claude Code / Codex ──▶ Vercel 函数 (Next.js)
                                    ├─ /v1/chat/completions, /v1/responses, /v1/embeddings  (OpenAI 协议)
                                    ├─ /v1/messages                                          (Anthropic 协议)
                                    ├─ /v1beta/models/{m}:generateContent                    (Gemini 协议)
                                    ├─ /admin  管理后台
                                    └─ /api/stripe/webhook  (M1)
                                         │
             鉴权 → 定价校验 → 余额校验 → 选渠道（来源 / 优先级 / 权重）→ 转发 → 失败自动切换
                                         │
                ┌────────────────────────┼─────────────────────────┐
             official                  cloud                    reseller
     OpenAI / Anthropic / Gemini   Azure / Bedrock / Vertex   兼容中转站
                                         │
                                Postgres（用户、密钥、渠道、价格、用量日志、余额流水）
```

- 同一协议直通转发，不做跨协议转换（M2 再评估）。所以客户用哪种 SDK，就走对应协议的渠道。
- 计费依据上游返回的 usage，统一归一化为：非缓存输入、输出、缓存读、缓存写。

## 2. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0 网关可用** | 5 个协议端点、8 种上游、三类来源路由与故障转移、流式计费、凭据加密、管理后台（渠道 / 价格 / 路由 / 用户 / 密钥 / 日志）、单元测试 + 端到端测试、CI、Vercel 配置 | ✅ 完成 |
| **M1 能卖** | 用户自助注册 / 登录（邮箱验证 + Turnstile）；用户控制台（自建 API key、看余额和用量）；**Stripe Checkout 充值** + webhook 幂等入账（`balance_transactions.reference` 唯一）；公开价格页；低余额邮件 | 下一步 |
| **M2 能算账** | 每日对账（Stripe ↔ 充值 ↔ 余额）；按来源、渠道、客户的毛利报表；上游余额和错误率告警；渠道连续失败自动熔断；可选 OpenAI ↔ Anthropic 协议转换 | |
| **M3 能批发** | 代理商（子账户、进货价、自定价、白标域名）；佣金结算；风控（单 key 并发 / QPS、异常地域、拒付追回） | |
| **M4 规模化** | Upstash Redis 限流和缓存；日志冷热分离；多区域；Stripe Billing 订阅套餐 | |

## 3. 风险

| 风险 | 应对 |
|---|---|
| Vercel 函数时长上限（Hobby 300 秒，Pro 800 秒） | 长输出可能被截断。量起来之后，把 `/v1/*` 单独部署到常驻进程平台（Fly.io、Railway），代码不用改 |
| Vercel 请求体 4.5 MB 上限 | 大图、大文件请求会失败。同上 |
| 上游条款 / 封号 | 多来源冗余，cloud 和 official 优先；后台一键关闭某个来源 |
| 计费错误 | 端到端测试覆盖每种协议的计费；M2 加对账 |
| `ENCRYPTION_KEY` 丢失 | 所有渠道凭据都无法解密，需要重新录入。务必备份 |
