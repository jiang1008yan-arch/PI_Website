# PI Website — 售后工单 / 中英文PI关联 / 售后角色 / 内部对接预留

> 本文档为经过逐分支 grill 后**定稿**的实施计划。所有「已确认」项为与用户拍板的决定。

## Context

当前系统是一个 Cloudflare Pages + Hono + D1(SQLite) + R2 的销售门户：

- **PI**：中/英文 PI 共用一张 `pi` 表(用 `language` 区分),是两份互相独立的文档。英文 PI 可直接导出 Excel；中文 PI 走审核流程(`DRAFT → PENDING_REVIEW → APPROVED`)。
- **角色**：当前仅 `ADMIN` / `USER`,`users.role` 有 `CHECK (role IN ('ADMIN','USER'))`。密码 bcrypt 哈希,无自助改密。
- **认证**：JWT(12h),`functions/api/[[path]].ts` 中间件除 `POST /api/auth/login` 和 `GET /api/files/*` 外全部要求登录。
- 目前无工单系统,无任何对外/对内集成出口。
- **字段配置已有成熟模式**：`productFields`(TEXT/DROPDOWN + options + defaultValue + sortOrder)+ `FieldRow.tsx` 编辑器 + 渲染逻辑,工单问卷将复用此模式。

本次新增 5 项需求,设计决定如下。

---

## 需求 1：中英文 PI 一步生成关联对

**基调(已确认):一次性生成,非持续同步。**
- 英文 PI **首次创建**时,服务端同时创建一份关联中文 PI 草稿(`linkedPiId` 双向关联),中文照常走审核流程。
- 英文 PI **后续编辑不自动同步**到中文。
- 英文页提供**「重新同步到中文草稿」按钮**,仅当关联中文 PI 仍是 `DRAFT`/`REJECTED` 时可用;点击才用最新英文数据重建中文草稿产品行,**保留中文专有表头字段**。中文一旦送审/通过则禁用。
- *理由*：持续同步会反复 DELETE+重插中文行,冲掉销售手填的中文专有字段(生产订单号/客户来源/客户类型/交期),且需额外状态校验防覆盖已送审内容。一次性生成开销仅几十毫秒且复用本就要做的取号逻辑。

**填写页面保持各自独立**：`/pi/en` 与 `/pi/zh` 仍是两个独立页面,版式差异由模板层处理(分语言 Excel 模板、`exportPi.ts` 按 language 分支、`piFieldPositionsEN/ZH`)。`pi` 表是字段超集,各语言只填自己用到的列。

**数据模型**
- 迁移新增 `pi.linkedPiId TEXT`(可空),两份 PI 互填对方 id。
- 迁移新增 `productFields.mapKey TEXT`(可空)——中英字段的显式对应键。
- schema/类型同步：`functions/lib/schema.ts`、`functions/lib/piAccess.ts` 的 `PiRow`、`web/src/types.ts` 的 `Pi` 加 `linkedPiId?`,`ProductField` 加 `mapKey?`。

**字段映射配置(已确认:下拉选对应字段,key 系统生成)**
- 在产品管理页 `web/src/products/FieldRow.tsx`,编辑**中文字段**时给一个下拉「对应英文字段」,列出该产品所有英文字段;选中即关联,底层存共享 `mapKey`,**key 由系统生成,管理员不手打**(避免自由文本拼错导致静默配不上)。可显示已对应/未对应状态。编辑器需多加载一次另一语言字段列表(产品配置页低频)。
- 服务端 `functions/api/routes/products.ts` 的 `POST /products/:id/fields`、`/fields-bulk`、`PATCH .../fields/:id` 三处持久化 `mapKey`。

**行项目字段值映射规则(已确认)**
- `productId/quantity/unitPrice/discountPct` 1:1 复制。
- `fieldValues` 按 `productId` 查 ZH `productFields` 用默认值铺底,再对每个带 `mapKey` 的 ZH 字段从 EN item 找同 `mapKey` 的 EN 字段值带入:
  - **文本字段**：值原样复制。
  - **下拉字段**：按**选项序号(position)**搬——EN 选中第 N 个选项,ZH 设成其第 N 个选项;序号越界回退 ZH 默认值。
  - **约定**：管理员维护中英下拉选项时**保持顺序一致**(写进产品管理页提示),**不做逐选项 Red→红色 映射 UI**。
  - 未配 mapKey 的字段保持 ZH 默认值。

**服务端**(`functions/api/routes/pi.ts` 的 `POST /pi`)
- `language === "EN"` 且未带 `linkedPiId` 时,插入英文 PI 后:`nextPiNumber(c.env, "ZH", date)` 生成中文号 → 插入 `language='ZH'`、`status='DRAFT'`、相同 `createdById` 的中文 PI → 复制共享表头列、中文专有列留空 → 按上述规则生成行项目 → 互写 `linkedPiId` → 返回 `{ id, piNo, linkedZhId, linkedZhPiNo }`。
- 幂等:已带 `linkedPiId` 的不再二次创建(现有 `save()` 对已存在 PI 走 PATCH)。

**前端**
- `usePiEditor.ts` 的 `save()`：英文首次创建后用返回的 `linkedZhId` 提示「已生成关联中文 PI 草稿」。
- `PiPage.tsx`：英文视图加「前往关联中文 PI」按钮(跳 `/pi/zh?piId=<linkedZhId>`)+「重新同步到中文草稿」按钮(仅 DRAFT/REJECTED 可用)。

---

## 需求 2：售后工单系统

**公开提交入口(已确认:销售/售后生成带令牌链接 + Turnstile)**
- **不做单一通用公开链接。** 销售或售后在后台生成带 token 的链接(`/ticket/new?t=<token>`)发给特定客户。
- 新增 `ticketLinks` 表(有状态):`{ id, token, 预绑 customerInfo/orderNo, createdById, createdByRole, assignedSalesId, assignedServiceId, expiresAt, revokedAt, createdAt }`。生成者能看到自己发出的链接、是否使用、随时作废。
- **有效期 7 天,期内可多次提交**(客户可分次补充/重进,7 天后自然失效)。
- **Cloudflare Turnstile 第一天就上**(免费反机器人,服务端校验 token)+ 服务端字段长度/必填校验。
- 中间件白名单放行(写法同 `/api/auth/login`):`POST /api/public/tickets`、`GET /api/public/ticket-form`、`GET /api/public/products`。

**问卷字段(已确认:管理员可配置,克隆 productFields 模式)**
- 新建 `ticketFields` 表,结构照搬 productFields(`label/fieldType TEXT|DROPDOWN/options/required/sortOrder`);管理员编辑器**复用 `FieldRow` 组件**;公开表单按表渲染;客户答案存 `tickets.answers` JSON。
- **分层:固定骨架 + 可配血肉**。固定列 = 联系人、联系方式、status、令牌预绑的客户/订单(用于查询/列表/展示);只有问卷内容走可配字段 → answers JSON。
- **产品选择(已确认)**:客户在公开表单选,选项来自 products 主数据(单一数据源)。放行 `GET /api/public/products`——只 `SELECT code, nameEn/nameZh FROM products WHERE status='ACTIVE'`,**绝不出价格/成本/模板等敏感字段**,套在令牌 + Turnstile 同一道门后。

**数据模型(新迁移)**
- `tickets`：`id, ticketNo(唯一,新建 ticketNumber.ts), status('NEW'|'IN_PROGRESS'|'RESOLVED'|'CLOSED'), customerName, customerContact, customerCompany, orderNo, answers(JSON), source, assignedSalesId, assignedServiceId, createdAt, updatedAt`。
- `ticketUpdates`：`id, ticketId, actorId, actorRole, note, statusFrom, statusTo, createdAt`(时间线;客户提交首条 actorId 可空)。

**双责任人 + 指派(已确认)**
- `tickets` 存 `assignedSalesId` + `assignedServiceId`。
- 谁发链接,谁那侧责任人默认=自己(销售发→assignedSalesId;售后发→assignedServiceId);另一侧可选指定或留空、后补(ADMIN 或对应角色补)。至少发起方那侧明确 = "必须明确责任人"。

**权限(已确认)**
- **ADMIN**：全权(看 + 改 + 指派)。
- **SERVICE(售后)**：浏览全部工单 + 改状态 + 写备注 + 自领/被指派。
- **SALES(销售)**：浏览全部工单,**纯只读**(不改状态、不写备注);仅能生成工单链接。
- 可见性不按归属过滤,三类角色都能看全部工单。

**状态流转(已确认)**
- `NEW → IN_PROGRESS → RESOLVED → CLOSED`,允许 `RESOLVED → IN_PROGRESS` 重开。
- 只有 SERVICE/ADMIN 能改状态。每次变更写一条 `ticketUpdates`(statusFrom→statusTo + actor)。
- 暂不加额外状态(待客户确认/寄回维修等)。

**备注(已确认)**：工单详情页给一个点进去写备注的板块(`ticketUpdates` 自由文本)。**只有 SERVICE/ADMIN 能写,销售纯只读。**

**统计(已确认)**：轻量统计面板,三项指标——按状态计数、按问题类型(来自可配问卷下拉)、按产品类型(来自产品选择字段)。**ADMIN/SERVICE/SALES 三类角色都能看。** 暂不做按责任人/时间段/解决时长(均为单表聚合,成本极低)。

**服务端路由**
- `functions/api/routes/publicTickets.ts`(免登录):`GET /public/ticket-form`(返回 ticketFields 配置)、`GET /public/products`(精简产品)、`POST /public/tickets`(校验 Turnstile + 令牌有效性 → 生成 ticketNo → 插 tickets(status='NEW') + 一条 ticketUpdates)。
- `functions/api/routes/tickets.ts`(登录):`GET /tickets`、`GET /tickets/:id`(含时间线)、`PATCH /tickets/:id`(改状态/指派,限 SERVICE/ADMIN)、`POST /tickets/:id/updates`(备注/状态变更,限 SERVICE/ADMIN)、`GET /tickets/stats`、`POST /ticket-links`(生成链接)、`GET /ticket-links`、`POST /ticket-links/:id/revoke`。
- `functions/api/routes/ticketFields.ts`(ADMIN):问卷字段 CRUD。
- 访问控制放 `functions/lib/ticketAccess.ts`(仿 piAccess 的 Verdict 模式)。
- 新建 `functions/lib/ticketNumber.ts`(仿 piNumber)。

**前端**
- 公开页(放 `ProtectedRoute` 之外,不走 `Layout`):`/ticket/new` → `web/src/pages/PublicTicketForm.tsx`。
- 内部页:`Tickets.tsx`(列表+统计)、`TicketDetail.tsx`(详情+时间线+备注+状态/指派)、`TicketLinks.tsx`(生成/管理链接);问卷字段配置进产品/设置管理区。
- `Home.tsx`：售后工单卡片(ADMIN/SALES/SERVICE 可见)。

---

## 需求 3：角色重命名 + 新增售后 + 全角色改密

**角色(已确认:USER→SALES 改名 + 新增 SERVICE)**
- 最终三角色:`ADMIN` / `SALES` / `SERVICE`。
- **迁移(同一条重建表做掉)**:`users.role` 的 CHECK 不能直接改 → `CREATE TABLE users_new (... CHECK (role IN ('ADMIN','SALES','SERVICE')))` → `INSERT INTO users_new SELECT id, ..., CASE role WHEN 'USER' THEN 'SALES' ELSE role END, ... FROM users` → drop/rename + 重建唯一索引。
- **全仓搜净所有 `"USER"` 角色字面量替换为 `"SALES"`**:`[[path]].ts`、`piAccess.ts`、`auth.ts`、seed、`Permissions.tsx`、`types.ts`(Role 加 SALES/SERVICE)。靠 TS 类型收敛,漏一处会权限错乱。
- 新增 `requireRole(user, roles[])`(放 `auth.ts`)供多角色接口用;`requireAdmin` 保留。
- `Permissions.tsx` 角色下拉提供 ADMIN/SALES/SERVICE。

**改密(已确认:做 ① + ②,不做 ③)**
- **① 自助改密**:`POST /auth/change-password { currentPassword, newPassword }` → 校验旧密码 → 存新哈希 + 最小强度校验。前端 `ChangePassword.tsx` + Layout 顶栏入口 + 受保护路由 `/change-password`。
- **② 管理员重置他人密码**(无邮箱找回的必备兜底):Permissions 页「重置密码」按钮 → `POST /users/:id/reset-password`(仅 ADMIN)→ 设新初始哈希。
- **③ 首次登录强制改密:不做**(以后真需要再加 mustChangePassword 标志 + 拦截流程)。

---

## 需求 4：内部后台对接(只写不读)——纯设计预留(方案 A)

**已确认:只建表 + 函数 + 文档,不接进任何流程。**
- 迁移新增 `integrationOutbox`：`id, eventType('TICKET'|'PI_ZH'), refId, payload(JSON), status('PENDING'|'SENT'|'FAILED'), attempts, createdAt, sentAt, lastError`。
- 写 `functions/lib/outbox.ts` 的 `enqueueOutbox(db, eventType, refId, payload)` 函数 + payload 契约注释。
- **不接进 approve/工单流程**:hook 点位置只留 `// TODO: enqueueOutbox(...)` 注释,表保持空,零负债(避免攒错 shape 的 PENDING 行)。
- `functions/scheduled.ts` 消费端 = TODO/留空。
- 推送目标 URL/密钥将来经 `wrangler.toml [vars]` + Secret 配置(INTERNAL_PUSH_URL/INTERNAL_PUSH_KEY)。
- **明确:不新增任何从公司后台读取数据的接口(只写不读)。**

---

## 需求 5：Cloudflare 成本评估

**结论:对这个内部 B2B 工具,Cloudflare 合适且省钱,建议继续使用。预算约 $0–5/月。**
- Workers/Pages、D1、R2 用量远在免费/低价区间;R2 出站流量 0 费用。
- 唯一真实成本/安全风险点 = **公开工单入口**,已用**令牌(7 天有效)+ Turnstile + 字段校验**收住。
- 建索引降低 D1 行读:`pi.language/status/createdById`、`tickets.status/assignedSalesId/assignedServiceId`、`ticketLinks.token`。
- 非成本风险:厂商锁定(D1 标准 SQLite 方言、R2 兼容 S3 API,迁移成本可控)。

---

## UI / 信息架构(已确认)

**导航现状**:无侧边栏/顶部菜单,**首页卡片网格即导航**;顶栏仅 Home 图标 + 品牌 + `用户名-角色` 徽章 + 退出。新功能 = 加卡片 + 加路由 + 页内交互。

- **工单**:首页加**单张「售后工单」卡**(ADMIN/SALES/SERVICE 可见)→ 工单中心,**页内 Tab**:工单列表 / 我发的链接 / 统计(按角色显隐)。
- **问卷字段配置**:不放工单中心,放进 **Product Management 页**(仅 ADMIN)。
- **Product Management 页改名为「Configuration / 配置中心」**:进去用两个区块分流——产品管理(分类/产品/产品字段/子模板)与工单问卷字段配置,各自点击进入。
- **PI 卡维持现状**:英文 PI / 中文 PI / 已确认接收 三张独立卡,**不并卡**(PI 是日常高频核心动作,不加额外点击)。
- **修改密码入口**:顶栏 `用户名-角色` 徽章做成**下拉菜单**(修改密码 / 退出登录),不动卡片网格;新增受保护路由 `/change-password`。
- **公开工单表单**:独立**品牌化单栏页**(不套 Layout),顶部 Logo,预绑信息只读展示,底部 Turnstile,提交成功整页切成功态显示工单号。**英文单语**(方案 C),不建 i18n/翻译基建,多语言靠**浏览器自带网页翻译**兜底(保证 `lang="en"` + 语义化 HTML)。
- **数据语言策略(方案 A)**:只锁**结构化字段**为英文——下拉/问题类型/产品选择**存英文 value**(显示层被浏览器翻译不影响底层值);**自由文本不强制翻译**(客户填什么存什么,内部借浏览器翻译阅读)。不上翻译 API。
- **工单详情页:双栏**。左主区=客户信息 + 问卷答案(只读)+ 备注时间线 + 追加备注框(SERVICE/ADMIN);右侧栏=状态徽章/改状态按钮 + 双责任人指派 + 元信息(单号/创建时间/来源)。销售只读时右栏操作按钮不渲染。
- **统计页:数字卡 + CSS 横条,零图表依赖**。状态计数=4 个数字卡;问题类型/产品类型=横向条形占比列表。不引 recharts/chart.js。
- **PI 页两个新按钮**:放英文 PI 编辑页已有操作按钮区(和保存/导出同排)。「重新同步到中文草稿」点击弹 `confirm` 二次确认,仅 DRAFT/REJECTED 可用否则禁用 + tooltip 说明。
- **FieldRow mapKey 下拉**:只在编辑中文字段时出现(`<select>` 选项=该产品英文字段列表 + "无"),紧挨字段类型那排;英文字段行不显示。

## 迁移清单(新增,按序)
1. `00XX_pi_linked.sql` — `ALTER TABLE pi ADD COLUMN linkedPiId TEXT;`
2. `00XX_product_field_mapkey.sql` — `ALTER TABLE productFields ADD COLUMN mapKey TEXT;`
3. `00XX_tickets.sql` — 建 `tickets` + `ticketUpdates` + `ticketLinks` + `ticketFields`(含索引)。
4. `00XX_roles_sales_service.sql` — 重建 `users` 表:USER→SALES + 放开 SERVICE。
5. `00XX_integration_outbox.sql` — 建 `integrationOutbox`(预留)。

(落地前确认 `package.json` 迁移脚本 / `wrangler d1 migrations apply` 用法。)

## 关键改动文件
- 后端:`schema.ts`、`types.ts`、`auth.ts`(requireRole + change-password)、`piAccess.ts`、`[[path]].ts`(放行公开工单+产品)、`pi.ts`(联动建 ZH + mapKey 映射)、`products.ts`(持久化 mapKey)、`users`(reset-password)、新增 `publicTickets.ts`、`tickets.ts`、`ticketFields.ts`、`ticketAccess.ts`、`ticketNumber.ts`、`outbox.ts`(预留)、`scheduled.ts`(预留 TODO)。
- 前端:`types.ts`、`App.tsx`(公开路由 + 工单/改密路由)、`Layout.tsx`(改密入口)、`Home.tsx`(工单卡片)、`Permissions.tsx`(SALES/SERVICE + 重置密码)、`FieldRow.tsx`(mapKey 下拉)、`usePiEditor.ts` + `PiPage.tsx`(关联 ZH 提示/跳转/重新同步)、新增 `PublicTicketForm.tsx`、`Tickets.tsx`、`TicketDetail.tsx`、`TicketLinks.tsx`、`ChangePassword.tsx`、工单字段配置页。

## 验证(端到端)
1. 本地起 dev,应用新迁移到本地 D1。
2. **需求1**：产品页给一对中英字段配 mapKey(下拉选对应字段)→ 建含该产品的英文 PI → 确认自动出现关联中文草稿、`linkedPiId` 双向、文本字段值带入、下拉按序号带入、未配字段留默认 → 英文页跳转 + 重新同步可用 → 中文页补全专有字段后送审→审核→导出。
3. **需求2**：销售生成链接 → 匿名访问该链接(过 Turnstile)提交问卷(含产品选择)→ 返回工单号 → 登录后 SALES 只读可见、SERVICE/ADMIN 可改状态/写备注/指派 → 统计三项指标正确 → 链接 7 天内可多次提交、可被作废。
4. **需求3**：现有 USER 迁移后变 SALES 且权限不变;新建 SERVICE 用户登录;任意角色自助改密后旧密码失效;ADMIN 重置他人密码生效。
5. **需求4**：确认 `integrationOutbox` 表存在但为空(未接流程);确认无任何读取公司后台的接口。
6. 类型检查/现有测试;UI 改动浏览器走通 golden path。
