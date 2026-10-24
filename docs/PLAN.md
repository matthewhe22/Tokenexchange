# TokenExchange 实施计划

> 目标：以 new-api 为底座，做少量、可持续同步上游的改造，加上自研的独立服务，搭一个"批发采购上游 token → 加价售卖给下游"的平台，部署在本仓库。

---

## 0. 先定下来的三件事（开工前必须决策）

| # | 决策 | 选项 | 建议 |
|---|------|------|------|
| D1 | **许可证路线** | A. 改过的 new-api 按 AGPL 公开源码；B. 向 QuantumNous 购买商业授权（support@quantumnous.com） | 先按 **A** 开工（不阻塞），同时去询价 B。仓库结构两种路线通用，见 §2 |
| D2 | **目标市场** | 国内 / 海外 / 两者 | 决定支付方式（易支付·支付宝·微信 vs Stripe）、是否需要备案、服务器放在哪 |
| D3 | **上游来源** | 官方 API 直采 / 云厂商（Azure、Bedrock、Vertex）/ 二级渠道 | 优先选官方或云厂商企业账号，条款风险最低 |

**署名义务（两条路线都要遵守，除非拿到授权）：**
- new-api：页脚或关于页保留 `Frontend design and development by New API contributors.`，并附原项目链接。
- one-api：new-api 本身是 one-api 的二开，one-api 要求"二开项目同样保留署名和链接"，所以关于页**同时**保留 one-api 的链接。

---

## 1. 总体架构

```
                    ┌──────────────── 下游客户 / 代理商 ────────────────┐
                    │  浏览器（商城、控制台）     SDK / Claude Code / Codex │
                    └───────────┬────────────────────────┬───────────────┘
                                │ HTTPS                  │ /v1/* API
                         ┌──────▼────────────────────────▼──────┐
                         │      Caddy / Nginx（TLS、WAF、限流）     │
                         └──────┬────────────────────────┬──────┘
             /shop, /portal     │                        │  /v1, /api, 控制台
        ┌───────────────────────▼───┐            ┌───────▼───────────────────┐
        │  services/（自研，可闭源）   │  管理 API   │  gateway/（new-api fork） │
        │  - storefront 商城/套餐     │──────────▶│  - 协议转换、渠道路由       │
        │  - billing 支付/对账/发票   │  (系统令牌) │  - 令牌、额度、计费日志     │
        │  - reseller 代理分销        │◀──────────│  - 少量补丁（见 §3）        │
        │  - procurement 成本/毛利    │  Webhook   └───────┬───────────────────┘
        │  - risk 风控               │                    │
        └──────┬────────────────────┘                    │ 上游请求
               │                                         ▼
        ┌──────▼──────┐  ┌─────────┐        OpenAI / Anthropic / Gemini /
        │ PostgreSQL  │  │  Redis  │        Azure / Bedrock / DeepSeek …
        │（两个库分开） │  └─────────┘
        └─────────────┘
```

**原则：**
1. 网关只做网关的事。转发、计费、额度这些核心链路尽量不动，跟上游走。
2. 商业差异化逻辑（定价策略、支付、分销、风控、成本核算）全部放在 `services/`，通过 new-api 的管理 API 和数据库只读副本交互。这样即使走 AGPL 路线，`services/` 也不受传染（独立进程，经网络 API 通信；上线前请律师确认）。
3. 对 new-api 的修改维持为**一小组清晰的补丁**，每次上游发版都能合进来。

---

## 2. 仓库结构

```
Tokenexchange/
├── gateway/                 # new-api fork（git subtree），AGPL-3.0，保留原 LICENSE
│   └── PATCHES.md           # 我们改了哪些文件、为什么
├── services/                # 自研服务（Go），专有许可
│   ├── cmd/                 # storefront / billing / reseller / procurement / risk
│   ├── internal/
│   │   ├── newapi/          # new-api 管理 API 客户端
│   │   └── ...
│   └── migrations/
├── web/                     # 商城前端（Next.js 或 Vite+React），专有
├── deploy/
│   ├── docker-compose.yml   # gateway + services + postgres + redis + caddy
│   ├── Caddyfile
│   ├── .env.example
│   └── backup/              # pg_dump 定时备份脚本
├── .github/workflows/       # CI：构建镜像、测试、上游同步检查
├── docs/
│   ├── PLAN.md              # 本文件
│   └── UPSTREAM_SYNC.md     # 同步上游流程
└── LICENSES.md              # 说明各目录许可证
```

- **路线 A（AGPL）**：`gateway/` 的源码对用户公开。最简单的做法是本仓库转公开，并把 `services/`、`web/` 拆到一个私有仓库；或者单独开一个公开仓库 `tokenexchange-gateway`，用 CI 自动同步。站点页脚放"源码"链接。
- **路线 B（商业授权）**：结构不变，整个仓库私有即可。

**上游同步：**
```bash
git subtree add  --prefix=gateway https://github.com/QuantumNous/new-api.git <tag> --squash
git subtree pull --prefix=gateway https://github.com/QuantumNous/new-api.git <new-tag> --squash
```
只跟 **release tag**，不跟 main。每次同步后跑完整回归（§6）。

---

## 3. 对 new-api 的修改清单（gateway 补丁）

改得越少越好，能用配置、管理 API、Webhook 解决的就不改代码。

| 编号 | 改动 | 原因 | 侵入性 |
|------|------|------|--------|
| P1 | 品牌化：名称、Logo、主题色、首页跳转到商城 | 多数靠后台"系统设置"完成；只有改不了的地方才改代码 | 低 |
| P2 | **计费事件 Webhook**：每条消费日志写库后异步推送到 `services`（或改为 services 轮询 / 读只读副本，零侵入） | 成本核算、毛利报表、风控实时性 | 中（优先用零侵入方案） |
| P3 | **渠道成本价字段**：每个渠道记录上游采购成本倍率 | 精确计算每次调用的毛利 | 中 |
| P4 | **代理商（reseller）字段**：用户表加 `parent_reseller_id`，代理商可在自己的额度范围内给下级开户、调价 | 批发业务的核心 | 中-高（也可以完全放在 services 里做，网关只看到普通用户） |
| P5 | 额外的风控钩子：单令牌并发、异常 IP、模型白名单 | 防盗刷、防撞库 | 低-中 |

> P4 建议**先放在 services 里实现**：代理商在 services 里管理下级，services 通过管理 API 在 new-api 里创建用户、令牌、充值。等跑通、确实遇到性能或一致性瓶颈，再考虑下沉到网关。

**从 one-api 借鉴的部分：**
new-api 已经包含了 one-api 的绝大部分代码，真正需要从 one-api 拿的很少：
- one-api 的 `docs/API.md` 管理 API 文档：结构清晰，作为我们 `internal/newapi` 客户端的对照（以 new-api 实际接口为准）。
- 个别 new-api 改坏或删掉、而 one-api 有的小逻辑，按需挑着移植。one-api 是 MIT，可以合进 AGPL 代码，但要保留其版权声明。
- **反方向禁止**：不要把 new-api 的代码复制进 `services/`（会被 AGPL 传染）。

---

## 4. 自研服务（services/）功能

### 4.1 采购侧（批发）
- 上游账户台账：供应商、账户、余额、采购单价、到期时间。
- 渠道成本价同步到网关（P3），按"模型 × 渠道"算成本。
- 余额与额度告警：上游余额低、渠道错误率高时通知（Telegram、飞书、邮件）。

### 4.2 销售侧
- **定价引擎**：基于上游官方价 × 分组倍率生成售价表；支持按客户分组、按量阶梯、套餐包（月卡、额度包）。最终写回 new-api 的模型倍率和分组倍率。
- **商城**：模型价格页、套餐购买、充值、兑换码。
- **支付**：国内（易支付聚合、支付宝当面付、微信 Native）/ 海外（Stripe、USDT 可选）。支付回调 → 校验 → 调 new-api 管理 API 给用户加额度，**幂等**（订单号唯一）。
- **对账**：每日核对 支付流水 ↔ 充值记录 ↔ new-api 额度变动。
- **发票 / 收据**：PDF 生成（企业客户需要）。

### 4.3 代理分销
- 代理商注册与审核；代理商从平台批发额度（进货价），自定义下级售价。
- 下级用户在代理商的白标子站注册（域名绑定 + Logo），实际都落在同一个 new-api 实例里。
- 佣金结算与提现。

### 4.4 风控
- 注册：邮箱验证、Turnstile、IP / 设备频率限制。
- 消费：单令牌 QPS 和并发上限、异常地域、短时暴增告警、自动冻结。
- 支付：拒付和退款追回、黑名单。

### 4.5 运营后台
- 毛利报表（按天、模型、渠道、客户、代理商）。
- 客户分层、公告、工单（初期可以接第三方）。

---

## 5. 分阶段路线

| 阶段 | 周期 | 交付物 | 验收标准 |
|------|------|--------|----------|
| **M0 基础设施** | 第 1 周 | subtree 引入 new-api（锁定 tag）；`deploy/docker-compose.yml`（gateway + Postgres + Redis + Caddy）；`.env.example`；CI 构建镜像；`LICENSES.md` | `docker compose up` 后能登录 new-api 后台，配一个上游渠道，用 curl 走通 `/v1/chat/completions`、`/v1/messages`、`/v1/responses` |
| **M1 能卖** | 第 2–3 周 | 品牌化（P1）；services 骨架 + new-api 管理 API 客户端；商城首页、价格页；**一种**支付方式 + 自动充值；基础定价表 | 新用户注册 → 付款 → 额度到账 → 生成令牌 → 调用成功 → 扣费正确，全链路自动 |
| **M2 能算账** | 第 4–5 周 | 消费日志同步（P2，优先零侵入）；渠道成本（P3）；毛利报表；对账任务；上游余额告警；备份与恢复演练 | 任意一天的 收入 − 成本 = 毛利 能对平，误差 < 0.1% |
| **M3 能批发** | 第 6–8 周 | 代理商体系（先在 services 里实现）；白标子站；佣金；风控 v1 | 代理商可自助开下级、调价，下级消费正确计入代理商毛利 |
| **M4 规模化** | 之后持续 | 第二种支付方式；多实例网关（new-api 主从 + Redis）；Prometheus + Grafana；上游同步自动化（每个 release 自动开 PR 并跑回归） | 压测达到目标 QPS；上游升级一次 < 半天 |

---

## 6. 测试与质量

- **网关回归套件**（`gateway` 升级必跑）：各协议（chat、responses、messages、gemini、embeddings、images、rerank）的流式和非流式调用；计费金额断言；额度不足、令牌过期、模型不允许等错误路径。用 mock 上游，避免真实花钱。
- **services**：单元测试 + 支付回调幂等测试 + 对账测试。
- **端到端**：Playwright 跑"注册 → 支付（沙箱）→ 调用 → 查账单"。

---

## 7. 部署方案

- **起步**：1 台 4C8G 云服务器 + 托管 PostgreSQL（或同机）+ Redis；Caddy 自动 HTTPS。
- **服务器位置**：海外市场选美西或新加坡；国内市场需要考虑备案和上游可达性（通常是"国内入口 + 海外出口"的双层结构）。
- **密钥**：上游 API Key 只存在网关数据库里；`.env` 不进仓库；数据库定期加密备份到对象存储。
- **发布**：CI 打镜像 → 推 GHCR → 服务器 `docker compose pull && up -d`；网关先灰度一个实例。

---

## 8. 主要风险

| 风险 | 应对 |
|------|------|
| AGPL 合规 | 走路线 A 就老实公开 `gateway/` 源码；或买授权。`services/` 与网关严格进程隔离 |
| 上游条款 / 封号 | 多供应商冗余，优先企业账号或云厂商；渠道自动禁用 + 告警 |
| 上游 new-api 大改导致补丁冲突 | 补丁最少化，只跟 release，每次同步有回归 |
| 盗刷 / 拒付 | 风控 v1 在 M3 前上线；新用户初始额度设为 0 |
| 计费错误导致亏损 | M2 的毛利对账是硬门槛，没过不开放代理商 |
| 国内合规（备案） | D2 确定后单独评估 |

---

## 9. 下一步（需要你确认）

1. D1 / D2 / D3 三个决策。
2. 确认后我从 **M0** 开始：引入 new-api（锁定最新 release tag）、写 docker-compose 和 CI，提交到 `claude/determined-cannon-nlyp94` 分支。
