# 首页改为"工作台" + 上线（Cloudflare / 飞书）检查清单

## 1. 首页（`web/src/pages/Home.tsx`）

**问题**：Admin 首页是 12 张同样大小、带装饰图的卡片，分三大段（PI / After-Sales / Administration），
要做的事（待审核、商务队列、新工单）和很少用的配置页（产品、权限、模板）混在一起、权重一样；
Sales 首页直接出现 After-Sales 模块，和销售的工作不对应。另外 Ticket Questionnaire 页在首页没有入口。

**做法**（按"先待办、再入口"排）：

1. **Needs your attention（待办）**：每个角色只看到自己要处理的队列，显示"等待数 + 未看过的 N new"。
   数量为 0 时显示灰色 "All clear"。
   - ADMIN：Pending Reviews、Commerce Queue、New Tickets、Newly Approved PIs
   - SALES：Newly Approved PIs；**只有当名下有未完结工单时**才出现 "Customer Tickets（N open）"
   - PRESALES：Pending Reviews；COMMERCE：Pending Commerce Approval；SERVICE：New Tickets
2. **Workspaces（入口）**：按业务区分成紧凑的列表面板（Sales / After-Sales / Administration / Commerce / Presales），
   每行一个图标 + 标题 + 一句说明；Administration 面板补上 Ticket Questionnaire 入口。
3. **SALES 不再有 After-Sales 模块和 Fault Analytics 入口**。路由权限不变：飞书私信里的工单链接照常能打开；
   工单页对 SALES 显示为 "Your Customers' Tickets"（`web/src/pages/Tickets.tsx`）。

未读徽标沿用 `web/src/pi/notifications.ts`（打开对应页面即清零）；各队列总数缓存在 `localStorage`
（`home-totals:<userId>`），首页先用缓存立刻画出，再后台刷新。

## 2. 上线检查清单

部署步骤见 [deploy-and-migrations.md](../deploy-and-migrations.md)，飞书配置见 [feishu-setup.md](../feishu-setup.md)。

### 部署
- [ ] `npx wrangler queues create app-jobs` / `app-jobs-dlq`（只需一次）
- [ ] Worker 密钥：`JWT_SECRET`、`AI_KEY_SECRET`（与 Pages 一致）、`CRON_SECRET`、`DEVICE_INGEST_SECRET`、
      `FEISHU_*`（售后机器人 5 个）、`FEISHU_PI_*`（PI 助手 4 个）；变量 `APP_BASE_URL`（正式域名，不带结尾 `/`）
- [ ] D1 迁移已到 `0022_request_claims.sql`：`npx wrangler d1 migrations list sales-portal-db --remote` 显示无待应用
- [ ] `npm run deploy`，先在 `*.workers.dev` 验证：登录、PI 列表/编辑/导出、文件上传下载、刷新深链接
- [ ] 域名从 Pages 移到 Worker；删除 `sales-portal-cron`（否则定时任务每 30 分钟跑两次）

### 飞书（两个应用都要做）
- [ ] 售后机器人：事件地址 `https://<域名>/api/feishu/events`（接收消息 v2.0），回调地址 `https://<域名>/api/feishu/card`（卡片回传交互）
- [ ] PI 助手：事件和回调都填 `https://<域名>/api/feishu/pi/events`；安全设置 → 重定向 URL `https://<域名>/api/auth/feishu/callback`
- [ ] 先设好 Worker 的 Encrypt Key / Verification Token 再在飞书保存地址（飞书保存时立即校验）
- [ ] 发布应用版本
- [ ] 真机走一遍：私聊机器人发消息 → Prepare ticket → Create ticket；工单卡片 Take / 改状态；
      门户里改状态后卡片同步；中文 PI 提交 → 售前卡片 Approve → 商务卡片 Approve → 提交人收到结果；
      "Sign in with Feishu" 登录
- [ ] `FEISHU_SERVICE_CHAT_ID` 群里收到周一汇总（可用 `POST /api/internal/cron` + `x-cron-secret` 手动触发一次）

## 3. 本次已验证（本地 `wrangler dev`）

- `npm run typecheck`、`npx vitest run`：37 个文件、397 个用例全部通过（含用假飞书 API 的 `feishu.int.test.ts`、`piAssistant.int.test.ts`）。
- 按飞书真实格式对本地 Worker 发请求（加密 + 签名）：
  - 售后机器人 `/api/feishu/events`、`/api/feishu/card`，PI 助手 `/api/feishu/pi/events`：加密的 url_verification 正确回显 challenge
  - 错误的 Verification Token、错误的 Encrypt Key、错误签名都返回 401；售后机器人的 token 不能用于 PI 助手
  - 消息事件 15ms 内返回 200（飞书要求 3 秒内）；重复 message_id 被去重
  - 未绑定的人点卡片按钮，收到 "Link your Feishu account first" 提示
  - `/api/auth/feishu/start` 302 跳到 `accounts.feishu.cn/open-apis/authen/v1/authorize`，回调地址正确
- **未验证**：真实飞书租户里的卡片渲染、卡片原地更新、真实推送。开发环境的网络策略不允许访问 `open.feishu.cn` 和 `api.cloudflare.com`。
