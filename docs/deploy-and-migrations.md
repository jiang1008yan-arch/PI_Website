# 部署与数据库迁移（重要）

## 核心概念：代码部署 ≠ 数据库迁移

| | 谁更新 | 何时 |
|---|---|---|
| **代码**（前端 + Workers 函数） | Cloudflare Pages 的 Git 集成 | push/merge 到 `main` 自动 |
| **D1 表结构**（表/列） | `wrangler d1 migrations apply --remote` | 过去靠人手动，现在由 CI 自动 |

Cloudflare Pages 只部署代码，**不会**应用 D1 迁移。两者一旦脱节（新代码引用了一个迁移才会加的列，
而该迁移没在线上跑），线上就会 500、表现为"列表空白 / 按钮点不动"。

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
