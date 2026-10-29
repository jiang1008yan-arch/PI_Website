# 部署与数据库迁移（重要）

## 核心概念：代码部署 ≠ 数据库迁移

| | 谁更新 | 何时 |
|---|---|---|
| **代码**（前端 + API，单个 Worker） | `npm run deploy`（= `npm run build && wrangler deploy`），或 Workers Builds 的 Git 集成 | 手动 / 接入 Workers Builds 后 push 到 `main` 自动 |
| **D1 表结构**（表/列） | `wrangler d1 migrations apply --remote` | 过去靠人手动，现在由 CI 自动 |

部署 Worker 只发布代码，**不会**应用 D1 迁移。两者一旦脱节（新代码引用了一个迁移才会加的列，
而该迁移没在线上跑），线上就会 500、表现为"列表空白 / 按钮点不动"。

## 架构：单个 Worker（已从 Cloudflare Pages 迁移）

站点现在是**一个 Worker + 静态资源**（`wrangler.toml` 的 `main = "src/worker.ts"`）：

- `fetch`：`/api/*` → Hono（`functions/api/[[path]].ts` 导出的 `app`）；其余路径 → `env.ASSETS`（`web/dist`），
  未命中的前端路由回落到 `index.html`（`not_found_handling = "single-page-application"`）。
  `run_worker_first = true` 保证 `/api/files/...` 这类下载链接在浏览器直接打开时也进 API，而不是被当成前端路由。
- `queue`：消费 `app-jobs` 队列（飞书机器人后台任务；目前只记录日志并 ack），失败 3 次进 `app-jobs-dlq`。
- `scheduled`：每 30 分钟（`*/30 * * * *`）跑 `functions/scheduled.ts` 的 `runScheduledJobs`（清理过期 PI、
  重试飞书推送、提醒、周报、设备离线等），取代 Pages 时代单独的 cron Worker（`workers/cron`）。

Pages 不支持 Queue 消费者和 Cron，这是迁移的原因。

### 首次切换（Pages → Worker，只需做一次）

1. **创建队列**（需要已 `wrangler login`）：
   ```bash
   npx wrangler queues create app-jobs
   npx wrangler queues create app-jobs-dlq
   ```
2. **设置 Worker 密钥**（Pages 的密钥不会自动带过来，逐个重新设置；值与 Pages 项目里的一致）：
   ```bash
   npx wrangler secret put JWT_SECRET
   ```
   同样设置 Pages 上已有的：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_VERIFICATION_TOKEN`、`FEISHU_ENCRYPT_KEY`、
   `FEISHU_SERVICE_CHAT_ID`、`FEISHU_PI_APP_ID`、`FEISHU_PI_APP_SECRET`、`FEISHU_PI_ENCRYPT_KEY`、
   `FEISHU_PI_VERIFICATION_TOKEN`、`AI_KEY_SECRET`、`CRON_SECRET`、`DEVICE_INGEST_SECRET`，以及变量 `APP_BASE_URL`。
   以 Pages → Settings → Variables 里的实际列表为准（如 `ALLOW_DEFAULT_ADMIN`）。**`AI_KEY_SECRET` 也必须一致**，否则大家保存的 AI key 无法解密。
   **JWT_SECRET 必须与 Pages 相同**，否则切换后所有人的登录会失效。
3. **部署**：`npm run deploy`。先用 `https://sales-portal.<子域>.workers.dev` 验证登录、PI 列表/编辑、导出、
   文件上传下载、刷新深链接。
4. **迁移自定义域名**：Pages 项目 → Custom domains → 移除该域名；然后 Worker → Settings → Domains & Routes →
   Add → Custom domain，填同一个域名（DNS 记录由 Cloudflare 自动改指向 Worker）。
5. **删除 cron Worker**：域名切到本 Worker 后，`sales-portal-cron`（`workers/cron`）就多余了，且会让任务每 30 分钟跑两次：
   `npx wrangler delete --config workers/cron/wrangler.toml`。飞书开放平台里的事件/回调地址用的是同一个域名，无需修改。
6. **保留 Pages 项目**直到确认 Worker 稳定，然后再删除。
   注意：Pages 项目若仍连着 Git，合并本次改动到 `main` 后它会用 dashboard 配置继续构建（`wrangler.toml` 已不再是
   Pages 配置）——在切完域名前，建议到 Pages → Settings → Builds 暂停自动部署。
7. （可选）Worker → Settings → Builds 连接本 GitHub 仓库，构建命令 `npm run build`、部署命令 `npx wrangler deploy`，
   恢复"push 到 `main` 自动部署"。

### 本地开发

```bash
npm run build
npm run db:migrate:local
npm run dev                      # wrangler dev，http://localhost:8788
npx wrangler dev --test-scheduled # 然后访问 /__scheduled 手动跑一次全部定时任务
```

本地密钥放 `.dev.vars`（已 gitignore），例如 `JWT_SECRET=dev-secret`、`ALLOW_DEFAULT_ADMIN=true`。
`[ai]` 绑定在本地也会访问 Cloudflare 远端（需要 `wrangler login`），目前代码尚未调用它。

## 自动迁移（`.github/workflows/d1-migrations.yml`）

- 触发：当 `migrations/**` 有变更被推到 `main`（或在 Actions 页面手动 `Run workflow`）。
- 动作：`wrangler d1 migrations apply sales-portal-db --remote`，把待应用的迁移补到线上 D1。
- 之后再加新迁移，**合并到 main 就会自动同步数据库**，不用再手动去 D1 控制台改。

## 一次性配置（浏览器即可，无需本地装软件）

### 1. 建一个 Cloudflare API Token
- https://dash.cloudflare.com/profile/api-tokens → **Create Token**
- 权限至少包含：**Account → D1 → Edit**（以及该账号/数据库的访问）。
- 复制生成的 token。

### 2. 把 token 存为 GitHub Secret
- 仓库 → **Settings → Secrets and variables → Actions → New repository secret**
- Name：`CLOUDFLARE_API_TOKEN`，Value：上一步的 token。
- （Account ID 已写在 workflow 里，非密钥；若变了可加仓库变量 `CLOUDFLARE_ACCOUNT_ID` 覆盖。）

### 3. 让 wrangler 的迁移追踪表对上现状（只需做一次）
线上有几个迁移是**手动**补的（如 `0011`），wrangler 并不知道，首次自动运行可能会想重复应用、报
`duplicate column name`。在 D1 Console 先核对、补登记：

```sql
-- 看 wrangler 当前认为应用了哪些（若报 no such table 见下方说明）
SELECT name FROM d1_migrations ORDER BY name;

-- 把"实际已应用但没登记"的补进去（INSERT OR IGNORE 安全幂等）
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0011_linked_pi_name_snapshot.sql');
-- 如 SELECT 显示 0006~0010 也没登记，则一并补：
-- ('0006_roles_sales_service.sql'),('0007_integration_outbox.sql'),
-- ('0008_pi_linked.sql'),('0009_product_field_mapkey.sql'),('0010_tickets.sql')
```

> 若 `d1_migrations` 表不存在，说明远端从没用 wrangler 迁移过——届时按实际已应用的迁移名把整张表补齐即可。

完成后，CI 首次 `migrations apply` 应显示 "No migrations to apply"（已对齐），此后新增迁移自动生效。

## 排查
- 线上 PI 列表空白 / 接口 500：多半是某个迁移没同步。打开 DevTools → Network 看 `GET /api/pi` 的响应，
  常见 `no such column: ...` 即指向缺失的列；对照 `migrations/` 找到对应迁移补跑。
</content>
