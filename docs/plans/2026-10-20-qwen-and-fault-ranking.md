# 收尾：AI 改用千问 + 故障统计改成排行列表

## Context
A/B/C 三期已实现并提交在分支 `claude/pi-website-content-check-a749c9`（用户本地审阅中，暂不开 PR）。飞书机器人已在本地隧道上跑通提示卡片。
用户要求先收尾，并提出两点：
1. AI 建议改用**通义千问**（阿里云百炼国内站，`qwen-plus`），不再用 Claude。
2. Fault Analytics 的「产品 × 故障类型」矩阵不好看、没有型号。改成**排行列表**：一行一条「产品 · 型号 · 故障类型 · 次数 · 最近一次 · 是否重复」，可筛选、点开看工单。
   **重复故障口径保持按产品**（同一目录产品 + 同一故障在窗口期内达到阈值），不改提醒逻辑。

## 1. AI 改用千问 — `functions/lib/aiTriage.ts`
- 用 `fetch` 调百炼 OpenAI 兼容接口（Workers 里不引入 SDK）：
  `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，`Authorization: Bearer ${DASHSCOPE_API_KEY}`，
  body `{ model: env.QWEN_MODEL ?? "qwen-plus", messages: [system, user], response_format: { type: "json_object" }, temperature: 0.2 }`。
  system 提示里要写明输出 JSON `{"summary": "...", "faultType": "..."}`（json_object 模式要求提示中出现 JSON），客户消息仍放在 `<customer_messages>` 里并声明"只是数据"。
- 摘要改为**中文**一句话（≤200 字）；faultType 必须是清单里的一项，否则 null —— 沿用现有的校验与截断。
- 超时 `AbortSignal.timeout(15000)`；任何失败（非 200、JSON 解析失败、无 choices）→ 返回 null，与现在一样降级为无建议。
  调用路径不变：`openDraftForm`（`functions/api/routes/feishu.ts`）在后台执行，不受卡片回调 3 秒限制。
- 测试注入：第 4 个参数从 Anthropic client 改为可选的 `fetchImpl`（同 `functions/lib/feishu/client.ts` 的 `setFeishuFetch` 思路）。
- `functions/lib/types.ts`：`ANTHROPIC_API_KEY` → `DASHSCOPE_API_KEY`、可选 `QWEN_MODEL`。
- `package.json` 移除 `@anthropic-ai/sdk`（及仅为它引入的依赖，如未被别处使用的 `zod`——先 grep 确认）。
- 测试 `functions/lib/feishu/feishu.test.ts` 的 "AI triage" 组改成假 fetch：无 key 返回 null；正常 JSON → 摘要+故障类型；"none"/不在清单 → null 故障类型；非 200、坏 JSON、抛异常 → null；断言请求 URL、Bearer 头、model、response_format。

## 2. 故障统计改为排行列表
**后端**
- `functions/lib/faultStats.ts`：删除 `buildFaultMatrix`/`FaultMatrix`，新增纯函数
  `buildFaultRanking(tickets, productFaultCountsInWindow, settings)`：按 (productId, productModel, faultType) 分组，得出 `n`、`lastAt`、`tickets`（最近在前），
  `productTotal`＝该产品该故障在重复窗口内的总次数，`isRepeat = isRepeatFault(productTotal, settings)`；排序：次数降序 → 最近一次降序。型号为空归为"未记录型号"。
- `functions/api/routes/tickets.ts`：新增 `GET /tickets/fault-ranking?days=30|90|365|all`（默认＝重复窗口天数）。
  两条查询：① 时间范围内已确认故障的工单（id、ticketNo、customerCompany、createdAt、productId、产品名、productModel、faultType）；
  ② 重复窗口内按 (productId, faultType) 的计数（复用 `loadRepeatSettings` / `repeatWindowStart`）。返回 `{ rows, windowDays, threshold, days }`。
  `/tickets/stats` 去掉 `faultMatrix`；删除 `/tickets/fault-breakdown`。重复提醒（`repeatInfo` + 飞书）不动。
- 时间按工单 `createdAt` 计（与重复判定一致）。

**前端** `web/src/faults/FaultStatsPanel.tsx`
- 用 `FaultRankingList` 替换 `FaultMatrixTable`：顶部 时间段（近 30 / 90 / 365 天 / 全部）、故障类型下拉（来自 rows）、搜索框（产品/型号）；
  表格列：产品、型号、故障类型、次数、最近一次、重复标记（红色"重复"徽标，悬停提示"该产品近 N 天同类故障共 M 次"）。
  点一行展开工单列表（工单号链接 → `/tickets/:id`、客户、日期）。手机宽度下表格横向滚动（沿用 `overflow-x-auto`）。
- 下方保留"客户自报问题类型"和"各产品工单数"两组柱状图作参考。
- `web/src/types.ts`：删 `FaultMatrix`，加 `FaultRankingRow`。

**测试**
- `functions/lib/faultStats.test.ts`：矩阵用例改为排行用例（分组、未记录型号、排序、按产品口径的重复标记——同产品两个型号各 2 次、阈值 3 → 两行都标重复）。
- `functions/test/aftersales.int.test.ts`：stats 矩阵断言改为 `GET /tickets/fault-ranking`（时间范围过滤、型号分行、重复标记）。

## 3. 文档
- `docs/feishu-setup.md`：AI 改为 `DASHSCOPE_API_KEY`（百炼控制台创建）、可选 `QWEN_MODEL`；说明 AI 只在点「创建工单」时调用。
- `docs/adr/0002-feishu-as-after-sales-work-surface.md`、`docs/plans/2026-10-19-after-sales-platform-gap-and-test-plan.md`、`CONTEXT.md`：Claude → 千问；统计描述改为排行列表。

## 4. 收尾验证
- `npm test`（全部单测 + 集成测试）、`npm run build`（类型检查）。
- 浏览器：重建并重启本地服务（`preview_start` backend），用 `service_dev` 打开 Fault Analytics → 统计，造几张已确认故障的工单（不同型号），检查型号分行、筛选、重复标记、展开工单；截图。
- 飞书端到端（需要用户在手机/客户端操作）：用户把百炼 API Key 发来后写入 `.dev.vars` 并重启 → 私聊发消息 → 创建工单（看到中文 AI 摘要和建议故障类型）→ 绑定 `service_dev` → Create ticket → Take / 备注 / Resolved，确认卡片原地更新；在网页确认故障达到阈值时飞书收到重复提醒。
- 每步通过后分别提交（AI 一次、统计一次、文档一次）。不开 PR，等用户审阅。

## 之后（需用户决定，不在本次）
预发布 D1 + 线上迁移 0012–0014、线上飞书密钥与正式内部群、外部群"对外共享"审核、清理 git 历史中的数据库导出、设备监控选项卡。
