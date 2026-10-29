# 个人 AI Key（千问 / DeepSeek）、工单类型、产品需求进飞书需求池、创建人即负责人

## Context
上一轮把 AI 改成了千问，Key 放在服务器环境变量里（提交 bc01daf）。用户评估了业内做法后决定：
1. **AI 可选，每人自带 Key**，支持 **千问和 DeepSeek**，在网页上填写。没填就没有 AI 建议，由售后自己判断。服务器统一 Key 的做法取消。
2. 工单加 **「类型」**：故障 / 产品需求 / 咨询或其他。工单标「已解决」前**必须**选好类型；类型是故障时，还要选故障类型。
3. **产品需求写入飞书多维表格「需求池」**。需求池由产品经理自己建，筛选、导出、分配、通知都在多维表格里完成，不新增角色，也不做导出页。
4. **谁创建工单谁就是负责人**。改负责人在平台上改，所有售后都有权限，每次修改都要留记录，并在飞书通知新的负责人。

参考的做法：
- 自带 Key：只能写不能读、按用户绑定加密、主密钥单独保管、保存时先测试、日志不出现 Key。
- 工单类型：Zendesk 的类型字段做法，强制填写才能保证统计有效。
- 需求池：Zendesk→Productboard 的需求池，以及飞书官方「客户声音 → 需求池」案例。

## 1. 个人 AI 设置
**数据**：新迁移 `migrations/0015_ai_types_requests.sql`，新建表 `userAiSettings`：
- 列：userId PK、provider `QWEN|DEEPSEEK`、apiKeyCipher、apiKeyIv、apiKeyLast4、model、updatedAt。
- 新文件 `functions/lib/aiKeys.ts`：
  - AES-256-GCM 加密，每次用新的 IV，**AAD 用 userId**，防止有人把别人的 Key 挪到自己名下。
  - 主密钥来自新的服务器密钥 `AI_KEY_SECRET`，与数据库、`JWT_SECRET` 分开。
  - 没配置 `AI_KEY_SECRET` 时不能保存 Key，页面提示「管理员尚未开启 AI」。
  - 只在调用 AI 时解密。
- **单测**：加密后能解回原文；userId 不同解不开；换主密钥后解不开。

**接口**：新文件 `functions/api/routes/aiSettings.ts`，只对 `canUseTickets` 的角色开放。
- `GET /me/ai`：返回 provider、model、`sk-****1234`，永不返回明文。
- `PUT /me/ai`：provider 为 QWEN、DEEPSEEK 或 OFF（OFF 即删除 Key），带 apiKey 和 model（可选）。
  - 填了新 Key 时，**先发一条极短请求验证**，通过才保存。
  - apiKey 留空表示保留原 Key，只改服务商以外的设置。
- `POST /me/ai/test`：用已保存的设置测一次。
- 所有报错信息先去掉 Key 和 Authorization 头再返回或写日志。

**调用**：改写 `functions/lib/aiTriage.ts`，两家都走 OpenAI 兼容格式。
- 千问：`dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，默认模型 `qwen-plus`。
- DeepSeek：`api.deepseek.com/chat/completions`，默认模型写代码前对照官方文档确认（当前为 V4 系列）。
- 统一用 `response_format: json_object`，提示词里写明 json 和输出样例，设置 `max_tokens`；返回空内容按失败处理。
- 输出增加 `ticketType`（FAULT / PRODUCT_REQUEST / OTHER）。
- 函数签名改为 `triageMessages({ provider, apiKey, model }, text, faultTypes, fetchImpl)`。
- `Env` 去掉 `DASHSCOPE_API_KEY` 和 `QWEN_MODEL`，加上 `AI_KEY_SECRET`。

**飞书**：`openDraftForm`（`functions/api/routes/feishu.ts`）改为使用点「创建工单」那个人的 AI 设置；他没设置就出不带 AI 的表单。草稿上的 AI 结果照旧缓存。

**网页**：
- 新页面 `web/src/pages/AiSettings.tsx`，路由 `/account/ai`。入口放在 `web/src/components/Layout.tsx` 右上角用户菜单，挨着「修改密码」。
- 页面内容：服务商（关闭 / 千问 / DeepSeek）、API Key（只能写，已保存时显示掩码）、模型（可选，带默认值）、「测试」「保存」「删除 Key」。
- 页面上写明：AI 只在飞书里点「创建工单」时调用，费用记在你自己的账号上。

## 2. 工单类型（解决前必填）
**数据**：0015 迁移给 `tickets` 加列：
- `ticketType`：FAULT、PRODUCT_REQUEST、OTHER，可为空，带 CHECK。
- `summary`：一句话摘要，可选。
- `bitableRecordId`：需求池里对应的行，可为空。
- 回填：已有 `faultType` 的工单设为 FAULT。

**逻辑**（`functions/lib/ticketService.ts`）：
- 新增 `setTicketType(db, user, ticketId, { ticketType, summary })`：
  - 权限同 `canConfirmFault`（SERVICE / ADMIN）。
  - 改成非故障时清空 `faultType`；确认故障类型时自动设为 FAULT。
  - 时间线记一条备注，例如「类型：产品需求」，写法同 `confirmTicketFault`。
- `changeTicketStatus` 改到 RESOLVED 时检查：
  - 没有类型 → 400「请先选择工单类型」。
  - 类型是 FAULT 但没有故障类型 → 400「请先确认故障类型」。
  - 网页和飞书卡片的 Update 都走这里；飞书上会弹出错误提示。
- 新接口 `PATCH /tickets/:id/type`。

**网页**（`web/src/pages/TicketDetail.tsx` 及工单详情面板）：
- 加「类型」下拉和「摘要」输入框。
- 选了 FAULT 才显示故障类型。
- 改状态为 Resolved 前，在前端也提示需要先填类型。

**飞书建单表单**（`draftCard`）：
- 加「类型」下拉，AI 建议作为预选。
- 故障类型下拉保留，旁边注明仅故障需要。
- 摘要输入框预填 AI 摘要。
- `confirm_draft` 写入 ticketType 和 summary。

## 3. 产品需求进飞书多维表格需求池
**配置**：
- Administration 里新增「产品需求池」设置（ADMIN），存在 `appOptions`。
- 管理员粘贴多维表格链接（`…/base/{app_token}?table={table_id}`），服务端解析出 app_token 和 table_id。
- 「检查表格」按钮：调用 `GET /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields`，核对需要的列都在，并列出缺少的列。
- 表格由产品经理在飞书里先建好，并把应用「售后工单Robot」加为可编辑的协作者。
- 应用需要新开通多维表格权限 `bitable:app`，并发布新版本。

**写入**：
- 工单**第一次**被设为产品需求时（网页或飞书都算），且 `bitableRecordId` 为空，就新增一行：
  `POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records`。
- 固定列名（文本列即可）：工单号、提交日期、客户、产品、型号、SN、摘要、客户原话、售后负责人、工单链接。
- 成功后记下 `record_id`；失败走现有 outbox 重试，错误写进 `lastError`。
- 实现：`functions/lib/feishu/client.ts` 加 `addBitableRecord`、`listBitableFields`；`functions/lib/feishu/sync.ts` 的 `afterTicketChange` 增加 `kind: "type"`。
- 之后再改类型不会删除已写入的行，只在工单时间线里记录。

**通知产品经理**：用多维表格自带的「自动化 → 新增记录时发送飞书消息」，由产品经理自己配置。`docs/feishu-setup.md` 写清步骤，本系统不另外发。

**在本系统里查看**：Fault Analytics 的统计只看故障。工单列表加「类型」筛选，方便售后查看产品需求。

## 4. 创建人即负责人 + 变更记录 + 通知
- `createTicket` 新增可选参数 `creator`：
  - 创建人是 SERVICE / ADMIN，且没指定售后负责人 → 售后负责人设为创建人。
  - 创建人是 SALES，且没指定销售负责人 → 销售负责人设为创建人。
- 网页建单（`POST /tickets`）和飞书 `confirm_draft` 传入 creator；客户公开表单不变。
- `PATCH /tickets/:id/assign` 抽成 `assignTicket`：
  - 负责人有变化时，时间线记一条备注，例如「售后负责人：张三 → 李四（由 王五 修改）」。
  - 然后更新飞书工单卡片，并**私信新的负责人**（需已绑定飞书），卡片附工单链接。
  - 权限不变：SERVICE / ADMIN 改售后侧，SALES / ADMIN 改销售侧。
- `takeTicket` 也记同样格式的备注。
- 飞书工单卡片只在没有售后负责人时显示 Take；已有负责人时直接改状态即可。

## 5. 私聊「绑定」
私聊机器人发「绑定」或「bind」时，直接回绑定链接，不弹「要创建工单吗？」提示。方便所有人主动绑定账号。

## 6. 测试
**单测**：
- aiKeys：加解密往返、AAD、主密钥。
- aiTriage：两家服务商的地址和默认模型、ticketType 校验、空内容按失败处理、报错里去掉 Key。
- 卡片：类型下拉、Take 的显示条件。
- 多维表格链接解析、字段映射。

**集成测试**：
- `functions/test/aftersales.int.test.ts`：
  - 设类型时清空故障类型，时间线有备注。
  - 没有类型不能标已解决；是故障但没故障类型也不能。
  - 创建人自动成为负责人；改负责人留下记录。
  - 设为产品需求后写入多维表格（假 fetch），只写一次；写入失败进 outbox 重试。
- `functions/test/feishu.int.test.ts`：
  - 点「创建工单」的人有 Key 才调用 AI；没 Key 不调用。
  - confirm_draft 写入类型和摘要。
  - 私聊「绑定」回链接。
  - 改负责人后私信新负责人。
- AI 设置接口：
  - 保存前先验证 Key；接口只返回掩码。
  - A 用户的 Key 不会被用在 B 用户身上。
  - 没配 `AI_KEY_SECRET` 时拒绝保存。
- 迁移测试：0015 回填正确，原有数据不变。

**浏览器**：
- `service_dev` 在 `/account/ai` 填一个假 Key，看到验证失败的提示；用真 Key 能保存，之后只显示掩码。
- 工单详情：改类型、改负责人，时间线出现记录；没填类型时标已解决被拦下。
- 管理员在「产品需求池」设置里粘贴链接，点检查，缺少的列能正确列出。

**飞书（需要你配合）**：
- 你在网页上填真实的千问或 DeepSeek Key，私聊建单时能看到中文摘要和类型建议。
- 建一张测试多维表格，把机器人加为协作者，开通 `bitable:app` 并发布新版本。
- 把一张工单设为产品需求，确认表格里出现新的一行。

## 7. 文档与提交
- `docs/feishu-setup.md`：
  - 个人 AI 设置。
  - `AI_KEY_SECRET` 本地写在 `.dev.vars`，线上用 `wrangler pages secret put AI_KEY_SECRET`。
  - 需求池表格的列名、协作者和权限设置，以及多维表格自动化通知的配置步骤。
  - 私聊「绑定」。
- `CONTEXT.md`：新增 Ticket type、Product request、Requirement pool（需求池）、Owner（创建人即负责人）。
- ADR 0002 补充：AI Key 由个人提供；产品需求进多维表格。
- 计划副本存到 `docs/plans/2026-10-20-ai-keys-ticket-types-requirement-pool.md`。
- 按 AI 设置、类型与已解决校验、需求池、负责人、文档分次提交。不开 PR。
