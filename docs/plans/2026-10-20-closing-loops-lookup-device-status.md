# 闭环与对齐：飞书只找负责人、定时汇总与提醒、字段联想、设备状态接口

## Context
试用后用户反馈：
1. 每张新工单都推到售后群太吵，改为**谁建的工单谁负责**：工单卡片只私信给负责人；售后群改为**每周一 9:00 汇总**。
2. 处理中的工单超过 **24 小时没更新**，私信提醒负责人（每天最多一次，合并成一条）。
3. 飞书建单表单提交成功后显示「已创建」；打开表单后 **6 小时不提交自动失效、变灰**。
4. 各模块字段没对齐：**生产令号、客户名称、设备 SN、产品/型号**都应从已有数据里联想，输入几个字就能匹配，选中后自动带出其他字段。用在：网页新建工单、客户链接、工单详情修改、飞书建单表单。
5. 设备在线、离线、故障码将来自充电桩后台，目前还没有接口资料。这次**先留好接收接口和告警规则**：发现问题推到售后群，谁点「创建工单」谁负责。

**重要发现：** Cloudflare Pages 不会执行 `functions/scheduled.ts` 里的 `onScheduled`，所以现有的清理过期 PI、飞书失败重试其实**从没运行过**。上面所有定时功能都需要一个真正的定时触发器，这是第一步。

分三期做，每期单独提交、单独验证。

## 第一期：定时触发 + 飞书只找负责人 + 汇总与提醒 + 表单失效

**定时触发器**
- 新建一个很小的 Cloudflare Worker：`workers/cron/`（`wrangler.toml` 配 `crons = ["*/30 * * * *"]`）。
  - 它每 30 分钟带上 `X-Cron-Secret` 请求头，调用 `POST /api/internal/cron`。
- Pages 端新增路由 `functions/api/routes/internal.ts`：
  - 用 `CRON_SECRET` 校验请求头，并加入 `[[path]].ts` 的 JWT 白名单。
  - 调用 `runScheduledJobs(env, now)`。
- `functions/scheduled.ts` 改为导出 `runScheduledJobs`，依次执行：
  - 现有的 `purgeExpired`、`drainFeishuOutbox`；
  - 新增：表单失效、负责人提醒、每周汇总。
  - 每项单独 try/catch，一项失败不影响其他项。
- 删除无效的 `onScheduled` 导出。部署说明写进文档。

**飞书只找负责人**（`functions/lib/feishu/sync.ts`）
- 工单卡片不再发到售后群：
  - 有售后负责人且已绑定飞书 → 私信发给负责人，之后原地更新这张卡。
  - 负责人换人时，新负责人收到一张新卡（`feishuCardMessageId` 换成新卡），旧卡更新为「已转给 XX」。
- 销售 @ 提醒、客户群回执和「已解决」通知保持不变。
- 重复故障提醒仍发到售后群。
- 客户自己 @机器人时，提示卡仍发到售后群，谁点「创建工单」谁就是负责人（现有逻辑已满足）。
- 客户链接提交的工单：负责人 = 链接上指定的售后，没指定时就是链接的创建人。

**表单失效**
- 新迁移 `0016`：`feishuDrafts` 加 `cardMessageId` 和 `expiredAt` 两列；发提示卡时记下卡片 id。
- 打开表单或提交时，草稿创建已超过 6 小时 → 返回提示「已失效，请重新 @我」，并把卡更新为灰色的「已失效」卡（`cards.ts` 新增 `expiredDraftCard`）。
- 定时任务把超过 6 小时、未建单、未标失效的草稿卡片批量更新为失效，并写入 `expiredAt`。
- 失效时长常量 `DRAFT_TTL_HOURS = 6`。

**负责人提醒**
- 0016 迁移给 `tickets` 加 `lastRemindedAt`。
- 定时任务的提醒范围：状态为「新建」或「处理中」、有售后负责人、`updatedAt` 早于 24 小时前、且 `lastRemindedAt` 为空或早于 24 小时前。
- 按负责人分组，每人合并发一条私信（工单号、客户、多久没更新、链接），然后写入 `lastRemindedAt`。

**每周汇总**
- 每周一北京时间 9:00 之后的第一次定时运行时发送；`appOptions` 记录 `weeklySummarySentFor = 当周周一日期`，防止重复发。
- 发到售后群，内容：
  - 上周新建、已解决的数量；
  - 仍未解决的工单按负责人列出，超过 7 天的标红；
  - 上周新出现的重复故障。
- 卡片构造放在 `cards.ts` 的 `weeklySummaryCard`（纯函数）。

**设置**
- 汇总时间、提醒间隔先用常量。
- 管理页暂不加可配置项（用户已选默认值），以后需要再加。

## 第二期：字段联想（生产令号 / 客户名称 / SN / 产品型号）

**后端** `GET /lookup?q=&kind=all|order|customer|sn`
- 新文件 `functions/api/routes/lookup.ts`；对 `canUseTickets` 的角色开放，飞书内部调用复用同一个函数 `functions/lib/lookup.ts`。
- 数据来源：
  - **生产令号**：已批准中文 PI 的有效版本（复用 `tickets.ts` 里 `approvedPisForOrder` 的 SQL 写法，含修订中读快照）。返回 PO、客户、PI 号、piId。
  - **客户名称**：已批准 PI 和历史工单里的客户名，去重，并标出各自的 PI 数和工单数。
  - **SN**：`devices` 表 join PI，返回 SN、PO、客户、piId。
- 匹配：不区分大小写的包含匹配，至少 2 个字符，每类最多 10 条；完全相同或开头相同的排在前面。
- `GET /lookup/pi/:piId/lines`：返回该 PI 的产品行（productId、名称、数量、原始行数据），网页端用现有的 `generatedModelFor` 算出型号。

**网页** 新组件 `web/src/components/LookupInput.tsx`
- 输入后防抖请求，下拉列出匹配项，支持键盘上下键和回车；也可以不选，直接用手输的文字。
- 用在以下位置：
  - `web/src/pages/CreateTicket.tsx`：客户名称、生产令号、SN 三个联想框。
    - 选生产令号 → 自动填客户；产品下拉缩小为该 PI 的产品行（显示型号）；SN 下拉列出该 PI 已登记的 SN。
    - 选 SN → 自动填生产令号、客户，以及对应 PI 的产品行。
    - 后端 `POST /tickets` 接收 `productModel` 和 `serialNumber`。
  - `web/src/tickets/TicketLinksPanel.tsx`：客户名称、生产令号。
  - 工单详情：
    - 新增「客户与生产令号」的编辑区（新接口 `PATCH /tickets/:id/customer`，带 customerCompany 和 orderNo，时间线记录修改）。
    - SN 输入框换成联想框。
    - `TicketPiPanel` 的产品行沿用现有逻辑。
  - 删掉被联想框取代的 `ProductionOrderHint` 提示。

**飞书建单表单**
- 打开表单时，在消息原文里找已有的生产令号和 SN（用数据库里的值做精确匹配，不用 AI），找到就直接预填。
- 表单加一个「查找」输入框和按钮（按钮的回调是 `lookup_draft`，会带上整张表单的值）：
  - 服务端用同一个查找函数，把卡片更新为「匹配结果」下拉，选项形如「PO · 客户 · PI 号」或「SN · PO · 客户」。
  - 已经填的内容通过 `default_value` 原样保留。
- 提交时如果选了匹配项，就用它带出客户、生产令号和 SN。产品和型号仍在网页工单详情里从 PI 产品行选。
- 卡片构造：`draftCard` 增加 `matches`、`prefill` 参数。

## 第三期：设备状态接口（先留接口，等充电桩后台资料）

- 0016 迁移（或单独的 0017）新增两张表：
  - `deviceStatus`：serialNumber PK、status `ONLINE|OFFLINE|FAULT`、faultCode、faultText、lastEventAt、offlineSince、alertOpenAt、alertTicketId。
  - `deviceEvents`：只追加，记录每条原始事件。
  - SN 不要求已在 `devices` 里登记，未登记的照样记录，告警里标「未登记」。
- 接收接口 `POST /api/devices/status`：
  - 机器对机器调用，请求头 `X-Device-Token` 与 `DEVICE_INGEST_SECRET` 比对，并加入 JWT 白名单。
  - 支持单条或批量：`{ serialNumber, status, faultCode?, faultText?, occurredAt }`。
  - 文档里写清楚格式，留给充电桩后台对接。
- 告警规则（纯函数，放 `functions/lib/deviceAlerts.ts`）：
  - 收到 FAULT → 立即告警。
  - OFFLINE 持续超过 2 小时 → 由定时任务检查后告警。
  - 同一 SN 有未处理的告警时不重复发；恢复 ONLINE 后关闭告警。
- 告警卡片发到售后群，内容：SN、客户、生产令号、PI、故障码、持续时长，按钮「创建工单」。
  - 点击的人就是负责人，复用现有的草稿和表单流程，表单里预填 SN、客户和生产令号。
- Fault Analytics 新增选项卡「Device monitoring」：列出当前告警和最近事件（只读）。

## 测试
**单测**
- 汇总卡、提醒分组、表单失效判定（固定时钟）。
- 查找的排序和截断。
- 设备告警规则：FAULT、离线 2 小时、去重、恢复。

**集成测试**（Miniflare + 假飞书接口）
- `/internal/cron`：密钥错误返回 401；每周汇总只发一次，周一 9 点前不发；24 小时提醒按人合并，24 小时内不重复。
- 6 小时失效：失效后打开或提交都被拒，卡片被更新。
- 新工单不再发到售后群，而是私信负责人；换负责人后新负责人收到卡片。
- `/lookup`：生产令号、客户名称、SN 三类匹配；修订中的 PI 读快照；COMMERCE 角色返回 403。
- 飞书 `lookup_draft` 更新卡片且保留已填内容；提交时用匹配项带出各字段；原文里的生产令号或 SN 会被自动预填。
- `/devices/status`：令牌校验、FAULT 立即告警、离线超时告警、不重复告警、恢复后关闭；点「创建工单」后预填 SN。
- 迁移测试：0016。

**浏览器**
- 新建工单：输入「0901」能联想出 PO，选中后客户、产品行、SN 自动带出；输入 SN 片段能反查。
- 工单详情：修改客户和生产令号，时间线有记录。
- Fault Analytics：Device monitoring 选项卡显示接口推入的测试数据。

**飞书（需要你配合）**
- 建单后卡片只私信给你，不再出现在售后群。
- 表单 6 小时后变灰（可临时把时长调小来验证）。
- 「查找」能出匹配下拉。
- 本地手动调一次 `/internal/cron`，看到每周汇总和提醒。

## 文档
- `docs/feishu-setup.md`：
  - 定时 Worker 的部署步骤、`CRON_SECRET`、`DEVICE_INGEST_SECRET`；
  - 飞书推送规则改为只找负责人；
  - 设备状态接口格式。
- `CONTEXT.md`：新增 Weekly summary、Update reminder、Draft expiry、Lookup、Device status/alert。
- 新 ADR `docs/adr/0003-cron-worker-for-pages.md`：说明为什么用单独的 Worker 来触发定时任务。
- 计划副本存到 `docs/plans/2026-10-20-closing-loops-lookup-device-status.md`。
- 每期单独提交，不开 PR。
