# 售后协同平台：细化方案、实施计划与测试

来源：`PI_Device_AfterSales_Plan_V1.1.docx`（2026-10），对照当前代码（main @ `66e9caa`）。

- 2026-10-19 初稿：现状对照与测试分层
- 2026-10-19 修订：按决定调整审批、保留期、售后可见范围
- 2026-10-19 再修订：在现有 UI/功能上逐条推敲后定稿。**ERP 交接本期不做；工单跟进改到飞书完成并回写；统计重点是同一产品上同一故障是否重复发生。**
  早先稿中的 ERP 交接记录、研发/产品任务分流、Mock 设备告警优先级均已作废。

术语见 [CONTEXT.md](../../CONTEXT.md)；关键取舍见 [ADR 0001](../adr/0001-revision-via-effective-snapshot.md)、[ADR 0002](../adr/0002-feishu-as-after-sales-work-surface.md)。

---

## 1. 现有 UI 事实（已核对代码）

- 首页按角色分区：PI（ADMIN/SALES）、After-Sales（全部角色）、Administration（ADMIN）。`web/src/pages/Home.tsx`
- ZH 流程界面叫 "Send to Recipient" → 接收人 "Confirm Received"/"Reject"；售前可在审核模式改单，改动在 Confirm 时一并写入。`web/src/pages/PiPage.tsx`, `web/src/pi/usePiEditor.ts`
- 待审队列 `/reviews`（ADMIN）：未指派或指派给我的 PENDING_REVIEW。`web/src/pages/ReviewPage.tsx`
- 工作区列表 `GET /pi` 一次返回全部（ADMIN 全部、SALES 自己的），分 Drafts / Sent for review 两组。
- 已批准 ZH PI 批准 14 天后被定时任务删除。`functions/scheduled.ts`
- SERVICE 读不到任何 PI（`canReadPi` 只允许本人或 ADMIN），路由上也进不了 `/pi/*`。
- 工单 "Order number" 自由文本；统计 `GET /tickets/stats` 取"问卷里第一个下拉题"当问题类型。`functions/api/routes/tickets.ts`
- `appOptions` 表 + `SelectWithManage`/`OptionSetModal` 已支持可维护的下拉清单。
- 只有一个生产 D1，推送到 main 时自动执行迁移；自动化测试只覆盖纯函数。

---

## 2. 敲定的结论

### A. PI：两级审批、修订、已批准 PI

1. **命名**：第一步 **售前确认**（沿用 Confirm Received，文案不变，ADMIN 执行，可在审核模式改单）；第二步 **商务批准**。只有商务批准后才是 **已批准**。
   状态显示：草稿 / 已驳回 / 待售前确认 / 待商务批准 / 已批准。
2. **新角色 COMMERCE（商务）**：共享队列，所有商务可见全部"待商务批准"，谁处理记谁。可批准/驳回（驳回理由必填），**不能修改**。
   **职责分离**：ADMIN 可看商务队列和详情，但不能做商务批准（按钮隐藏 + 接口 403）。缺人时 ADMIN 在权限管理里改角色。
   商务驳回 → 回到销售，修改后重新提交，**重新从售前开始**。
3. **只读 PI 详情页**（新页面，不动现有编辑器）：中文/英文标签切换，各有"下载 Excel"；底部"商务批准 / 驳回（理由输入框）"。
   SERVICE 复用此页：只看中文、不能下载、无审批按钮。
4. **商务首页**：「商务」分区 =「待商务批准」（角标，复用 `web/src/pi/notifications.ts`）+「已批准 PI」；另加「合同模板」。不显示工单、PI 创建、管理页。
5. **ERP 本期不做**：只提供中英文下载，不记 ERP 状态/下载记录；在商务批准处留挂点（同 `functions/lib/outbox.ts` 的 TODO 做法）。
6. **已批准 PI 列表组件**：一个搜索框（PI 号 / 生产令号 / 客户公司 / SN），按商务批准时间倒序，每页 50 + 加载更多，服务端分页。
   用于：商务「已批准 PI」、销售「Confirmed Received PIs」（只列自己相关）、售后「已批准 PI 查询」。
7. **工作区只放进行中**：/pi/zh 分四组（草稿 / 已驳回 / 待售前确认 / 待商务批准）；已批准的去列表组件找。
8. **保留期 3 年**：从最近一次有效版本的商务批准时间起算；修订进行中的 PI 不清理。
9. **批准后锁定**：审批过程中英文 PI 仍可改；商务批准后中文和关联英文都只读。
10. **修订**：已批准 PI 上的「修改」按钮，创建人销售或 ADMIN 可发起，**必填修改原因**；同一 PI 同时只有一个进行中的修订。
    修订重新走 售前确认 → 商务批准。修订批准前，**原批准版本仍是有效版本**（列表/售后/下载都用它，带「修订中」标记）；
    驳回后可继续改或放弃，放弃即恢复原样。PI 号不变，显示 Rev 1 / Rev 2…。
11. **修订审核呈现**：顶部显示修改原因；正文中相对有效版本变化的字段/产品行**高亮**（`computePiDiff`）。Review History 列出每次修订（Rev、发起人、时间、原因）及每步是谁做的。
12. **生产令**：一张 PI 一个生产令（保留 `pi.productionOrderNo` 单字段），提交时提示重号。

### B. 售后：反查 PI、SN、故障统计

13. **工单 Order number = 生产令号**，界面统一改为 "Production Order No."（公开表单、内部建单、链接面板、详情）。
    工单按生产令号**自动匹配**已批准中文 PI；详情页「关联 PI」卡片（进只读详情页），匹配不到显示"未找到对应 PI"。
14. **售后入口**：工单「关联 PI」卡片 + 首页 After-Sales 新增「已批准 PI 查询」。售后可见完整中文 PI（含客户联系方式），不能下载。
15. **设备 SN（只登记）**：只读详情页「设备 SN」区块，SERVICE/ADMIN 逐个添加或粘贴多行；SN 全局唯一，重复提示不覆盖；可按 SN 搜索。设备状态/告警以后再做。
16. **工单产品**：售后从匹配 PI 的产品行中选一个（带出目录产品 + 具体型号 `generatedModelFor`），有 SN 也记上。
17. **故障类型**：工单新增售后确认的「故障类型」，清单由 ADMIN/SERVICE 维护（`appOptions`）；AI 给建议、售后确认；统计只用确认值，客户问卷自选仅作参考。
18. **统计**：「目录产品 × 故障类型」矩阵，可下钻到具体型号和工单列表；取代"第一个下拉题"的隐式统计。
19. **重复故障**：确认故障类型时显示"该产品近 N 天同类故障已 M 次"及相关工单；达阈值时飞书内部群提醒。N 默认 90、阈值默认 3，ADMIN 可配。
20. 不做研发/产品经理转派；售后直接处理。

### C. 飞书机器人

21. **客户渠道按飞书外部群设计**（已查证：飞书外部群不能拉微信用户；机器人默认只收 @它 的消息，收全部群消息需敏感权限）。公开表单链接保留作兜底。
22. **触发**：员工对客户消息用「转为工单」（消息快捷操作），或客户 @机器人 → 机器人**私信**操作员工一张确认卡片：
    AI 只分析被选中的消息，给出摘要 + 建议故障类型；员工确认客户、生产令号、产品行、故障类型后建单。AI 结果标"AI 建议"，确认前不生效。
23. **内外分离**：客户外部群只发建单回执和"已解决"通知；内部售后群每张工单一张交互卡片（接单 / 更新进度：状态 + 备注），
    网页或飞书上的任何变化都**原地更新**这张卡片并 @ 工单上的销售。PI 审批事件本轮不推飞书。
24. **账号绑定**：首次点按钮时机器人私信绑定链接 → 登录本系统 → 存飞书 open_id；之后按系统角色判权限（SERVICE/ADMIN 可操作）。
25. 前提：飞书开放平台**企业自建应用**（机器人、消息快捷操作、卡片回调、对外共享以进外部群），需飞书管理员审核——在做 A 时就去申请。

### 实施顺序

**P0 测试底座 → A → B → C**。

---

## 3. 实施步骤

### P0 测试底座

- 预发布环境：`wrangler.toml` 加 `[env.preview]`（独立 D1 `sales-portal-db-staging` + R2）；`.github/workflows/d1-migrations.yml` 先跑预发布，生产改为手动触发。
- `functions/api/[[path]].ts` 增加 `export { app }`。
- 新建集成测试 harness：Miniflare 3 建内存 D1 → 按序执行 `migrations/*.sql` → 造各角色账号 → 签 JWT（复用 `functions/lib/auth.ts`）→ `app.fetch(req, env)`。
- 先给**现有**接口补集成测试作回归网：提交、售前确认/驳回、导出、工单建单/改状态/备注、公开表单提交。
- 时间注入：新代码和 `scheduled.ts` 的期限都用参数传入的 `now`，SQL 绑定参数。
- 把 `sales-portal-db-before-0006-0010-20260531.sql`（生产导出，含密码哈希）移出仓库；迁移测试用脱敏副本。清理 git 历史需另行确认。

### A. 两级审批 + 修订 + 已批准 PI

数据（新迁移，照 `migrations/0006_roles_sales_service.sql` 的挪表做法重建 users）：
- `users.role` CHECK 加 `COMMERCE`；`piReviewEvents` 加 `step`（PRESALES/COMMERCE）、`revisionNo`（不改 action 的 CHECK）。
- `pi` 加 `revisionNo`（默认 1）、`approvedAt`、`revisionInProgress`、`revisionReason`、`effectiveSnapshot`（修订期间冻结的有效版本 JSON，含 ZH 与关联 EN）。
- `piRevisions`：每次修订批准时追加一行（piId、revNo、reason、发起人、批准人、批准时间）。

修订实现见 [ADR 0001](../adr/0001-revision-via-effective-snapshot.md)：发起修订时把有效版本冻结进 `effectiveSnapshot`，live 行回到 DRAFT 走现有编辑器和工作流；
读有效版本的地方在修订中读快照；高亮 = `computePiDiff(effectiveSnapshot, live)`；商务批准时清空快照、Rev+1、写 `piRevisions`；放弃 = 用快照还原。

代码：
- `shared/piCapabilities.ts` 加 `PENDING_COMMERCE`、`COMMERCE`；EN 是否可写增加"关联 ZH 已锁定"输入。
- `functions/lib/piAccess.ts` 新增 `canCommerceApprovePi`/`canCommerceRejectPi`/`canStartRevision`/`canAbandonRevision`，扩展 `canReadPi`、`canExportPi`；每个都在 `piAccess.test.ts` 加表格行。
- `functions/lib/piWorkflow.ts`：售前确认改为进 PENDING_COMMERCE；新增商务批准/驳回、开始/放弃修订；仍是 `pi.status` 的唯一写入者。
- `functions/api/routes/pi.ts`：`POST /pi/:id/commerce-approve|commerce-reject|revisions|revisions/abandon`；`GET /pi/approved`（分页搜索）；`GET /pi/commerce-queue`；`GET /pi` 只返回进行中。
- `functions/scheduled.ts`：按 `approvedAt` 超 3 年且无修订进行中清理。
- 前端：只读详情页 `/pi/view/:id`、已批准列表组件、商务队列页；`PiPage.tsx` 四组列表、修改按钮、修订提示；`Home.tsx` 商务分区；`App.tsx` 路由；`Permissions.tsx` 加 COMMERCE。

### B. 售后反查 + SN + 故障统计

- 数据：`devices`（serialNumber UNIQUE、piId）；`tickets` 加 `piId`、`piItemId`、`serialNumber`、`faultType`、`faultConfirmedById`、`faultConfirmedAt`；故障类型清单与重复阈值放 `appOptions`。
- `functions/lib/ticketAccess.ts` 加 `canConfirmFault`、`canRegisterSn`；纯函数 `faultStats`（矩阵、重复次数，入参含 `now`）。
- 路由：`POST/DELETE /pi/:id/devices`；`PATCH /tickets/:id/product`、`PATCH /tickets/:id/fault`；`GET /tickets/stats` 改为矩阵 + 下钻；按生产令号匹配 PI。
- 前端：工单详情关联 PI 卡片、产品行、故障类型、重复提示；统计矩阵；文案 Order → Production Order No.；首页「已批准 PI 查询」；详情页 SN 区块。

### C. 飞书机器人

- 飞书客户端（token 缓存、发/更新卡片、读消息、签名校验，`fetch` 可注入）；AI 分诊（Claude API，失败降级为空建议）。
- 路由 `/api/feishu/events`（URL 校验、消息快捷操作、@机器人）、`/api/feishu/card`（按事件 id 去重）、`/api/feishu/bind`；JWT 白名单加 `/api/feishu/`。
- `users` 加 `feishuOpenId`；`tickets` 加 `feishuCardMessageId`、`feishuChatId`。
- 推送走 `integrationOutbox`（eventType 复用 `TICKET`）；`scheduled.ts` 补消费者（重试、`attempts/lastError`）。
- 新密钥：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_VERIFICATION_TOKEN`、`FEISHU_ENCRYPT_KEY`、`FEISHU_SERVICE_CHAT_ID`、`ANTHROPIC_API_KEY`。

---

## 4. 测试

| 层 | 内容 | 工具 |
|---|---|---|
| L1 纯函数 | 状态机、权限表、修订高亮、故障统计、飞书签名与卡片构造 | vitest（现有模式） |
| L2 API + D1 | 路由 + 真实 SQL：审计记录、接口层权限、事务 | vitest + Miniflare 3 |
| L3 迁移 | 生产脱敏副本上跑 users 重建迁移，核对行数/角色/哈希/外键 | 预发布 D1 |
| L4 浏览器验收 | 按角色走完整流程 | `wrangler pages dev` + 浏览器 |
| L5 外部替身 | 假飞书 API、假 Claude API、固定时钟 | 注入 `fetch` / `now` |
| L6 用户试用 | 售前/商务/售后/销售各一人试用 1–2 周 | 预发布环境 |

关键用例：
- 售前确认 → 待商务批准（step=PRESALES）→ 商务批准 → 已批准（step=COMMERCE）；商务驳回 → 已驳回 → 再提交从售前开始，两轮记录都在。
- COMMERCE 不能改、不能售前确认；ADMIN 不能商务批准；SERVICE 只读已批准 ZH、不能导出、看不到 EN。
- 修订：发起后列表和售后读到旧内容；高亮正确；放弃完全还原；批准后 Rev+1。
- 保留：固定时钟下 3 年减一天不删、超过删；修订中不删；草稿 3 天清理照旧。
- 已批准列表分页/搜索（PI 号、生产令号、客户、SN）；SN 重复处理；工单按生产令号匹配；统计矩阵与重复次数。
- 飞书：事件/卡片回调 → 工单时间线；未绑定或无权限被拒；重复投递只生效一次；outbox 失败重试；外部群只收回执与已解决。
- 飞书端到端：飞书测试企业 + 外部测试群走完"转为工单 → 私信确认 → 内部卡片 → 卡片改状态 → 网页时间线 → 外部群已解决"。
