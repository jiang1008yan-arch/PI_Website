# 充电桩设备状态推送接口说明

供**充电桩后台**向门户（Business Portal）推送设备状态使用。门户据此：

- 记录每台设备（按 SN）的最新状态和历史事件；
- 设备**故障**或**离线超过 2 小时**时，在飞书售后群里发告警卡片，售后可一键建工单；
- 设备恢复在线后自动关闭告警。

设备**不需要事先在门户里登记**：任何合法 SN 推过来都会被记录。如果该 SN 已登记在某张已审批的中文 PI 上，告警里会带上客户、生产订单号和 PI 号。

---

## 1. 接口概览

| 项目 | 内容 |
|---|---|
| 地址 | `POST https://sales-portal-85o.pages.dev/api/devices/status` |
| 鉴权 | 请求头 `x-device-token: <密钥>` |
| 请求格式 | `Content-Type: application/json`，UTF-8 |
| 单次上限 | 500 个事件 |
| 返回格式 | JSON |

> 地址以门户当前域名为准；如果门户以后换了自己的域名，会另行通知，路径 `/api/devices/status` 不变。

## 2. 鉴权

每个请求都要带请求头：

```
x-device-token: <DEVICE_INGEST_SECRET>
```

- 密钥由门户管理员生成，通过安全渠道单独提供，**不要写进代码仓库或日志**。
- 密钥不对、缺少请求头，或门户尚未配置密钥时，返回 `401`，整个请求都不处理。
- 请求头名称不区分大小写。
- 请只通过 HTTPS 调用。

## 3. 请求体

三种写法都可以，效果相同：

```jsonc
// 1）推荐：对象里放 events 数组
{ "events": [ { ... }, { ... } ] }

// 2）直接一个数组
[ { ... }, { ... } ]

// 3）单个事件
{ ... }
```

### 事件字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `serialNumber` | string | 是 | 设备 SN。会去掉首尾空格并**转成大写**。长度 3–64，只能包含字母、数字和 `.` `_` `/` `-`，且必须以字母或数字开头。 |
| `status` | string | 是 | `ONLINE` / `OFFLINE` / `FAULT`（不区分大小写）。 |
| `faultCode` | string 或 number | 否 | 故障码，如 `E12`。最多 64 个字符，超出部分截掉。只在 `FAULT` 时保存。 |
| `faultText` | string | 否 | 故障描述，如 `RCD tripped`。最多 500 个字符，超出部分截掉。只在 `FAULT` 时保存。 |
| `occurredAt` | string | 否 | 状态发生的时间，ISO 8601 格式，**建议带时区**，如 `2026-10-20T08:00:00Z` 或 `2026-10-20T16:00:00+08:00`。不填则用门户收到请求的时间。比门户当前时间晚 5 分钟以上的（时钟误差），按收到的时间处理。 |

## 4. 返回

### 成功（HTTP 200）

```json
{
  "accepted": 2,
  "rejected": [
    { "index": 2, "error": "status must be ONLINE, OFFLINE or FAULT." }
  ],
  "alerts": 1
}
```

| 字段 | 说明 |
|---|---|
| `accepted` | 本次接收的事件数。 |
| `rejected` | 被拒绝的事件：`index` 是它在请求数组里的位置（从 0 开始），`error` 是原因。**同一请求里的其他合法事件照常接收**。 |
| `alerts` | 本次请求新开的告警数（只有 `FAULT` 会当场开告警；离线告警由定时任务开，不计在这里）。 |

`rejected` 里可能出现的原因：

| error | 原因 |
|---|---|
| `Each event must be an object.` | 数组里的某一项不是 JSON 对象。 |
| `serialNumber is missing or invalid.` | 缺少 SN，或 SN 格式不符合第 3 节的规则。 |
| `status must be ONLINE, OFFLINE or FAULT.` | `status` 缺失或取值不对。 |
| `occurredAt must be an ISO 8601 date-time.` | `occurredAt` 无法解析为时间。 |

### 整个请求失败

| HTTP | 返回体 | 原因 | 处理建议 |
|---|---|---|---|
| 401 | `{"error":"Forbidden"}` | 密钥错误或缺失 | 检查请求头；不要重试同一个错误密钥。 |
| 400 | `{"error":"Body must be JSON."}` | 请求体不是合法 JSON | 修正后再发。 |
| 400 | `{"error":"At most 500 events per request."}` | 一次超过 500 个事件 | 拆成多次发送。 |
| 5xx / 超时 | — | 门户或网络临时故障 | 稍后重试（见第 6 节）。 |

## 5. 门户怎么处理这些状态

| 推送的状态 | 门户的处理 |
|---|---|
| `FAULT` | **立即**在飞书售后群发告警卡片（含 SN、故障码/描述，以及已登记时的客户、生产订单号、PI）。 |
| `OFFLINE` | 先记录离线开始时间；**连续离线满 2 小时**后，由每 30 分钟一次的定时任务发离线告警。 |
| `ONLINE` | 关闭这台设备当前的告警；之后再出问题会重新告警。 |

其他规则：

- **同一台设备在恢复 `ONLINE` 之前只告警一次**：告警期间重复推 `FAULT` 或 `OFFLINE` 不会再发卡片。
- **按 `occurredAt` 排序处理**：同一请求里的事件先按时间排序再处理；比门户已知最新状态更早的事件只写进历史记录，不改变当前状态。所以补发历史数据不会把设备状态改回过去。
- **重复推送是安全的**：同一事件推两次会在历史里记两条，但不会重复告警、也不会改变结果。
- 离线告警的 2 小时从**第一条** `OFFLINE` 事件的 `occurredAt` 算起；期间重复推 `OFFLINE` 不会重新计时。

## 6. 对接建议

1. **状态变化时推送**：设备上线、掉线、报故障、故障恢复时各推一条，带上准确的 `occurredAt`。不需要每分钟推心跳。
2. **掉线由后台判断**：设备自己掉线时无法上报，请由充电桩后台在判断设备失联时推 `OFFLINE`，恢复时推 `ONLINE`。
3. **攒批发送**：短时间内有多条事件时，合并成一个请求（每次最多 500 条）。
4. **失败重试**：遇到网络错误、超时或 5xx，按 1 分钟、5 分钟、15 分钟的间隔重试同一批数据。因为重复推送是安全的，重试不会造成重复告警。`400`、`401` 不要原样重试，请先修正。
5. **看 `rejected`**：返回 200 不代表每条都收下了，请记录 `rejected` 里的条目，便于排查数据问题。
6. **时区**：`occurredAt` 请带时区（`Z` 或 `+08:00`）；不带时区的时间可能被按 UTC 理解。

## 7. 示例

### 推送一条故障和一条恢复

```bash
curl -X POST "https://sales-portal-85o.pages.dev/api/devices/status" \
  -H "content-type: application/json" \
  -H "x-device-token: $DEVICE_INGEST_SECRET" \
  -d '{
    "events": [
      { "serialNumber": "CHG-0901-0001", "status": "FAULT", "faultCode": "E12", "faultText": "RCD tripped", "occurredAt": "2026-10-20T08:00:00Z" },
      { "serialNumber": "CHG-0901-0002", "status": "ONLINE", "occurredAt": "2026-10-20T08:01:30Z" }
    ]
  }'
```

返回：

```json
{ "accepted": 2, "rejected": [], "alerts": 1 }
```

### 设备失联

```json
{ "serialNumber": "CHG-0901-0003", "status": "OFFLINE", "occurredAt": "2026-10-20T09:00:00+08:00" }
```

如果到 11:00（北京时间）之后它仍没有推 `ONLINE`，售后群会在下一次定时任务（30 分钟内）收到离线告警。

## 8. 上线前的准备（门户一侧）

- [ ] 管理员生成 `DEVICE_INGEST_SECRET`，配置到门户的生产环境，并安全地交给充电桩后台。
- [ ] 管理员在门户 **After-Sales → Ticket Notifications** 里**先**选好售后群，再让充电桩后台开始推送。没有售后群时，告警只在门户的 Device monitoring 里显示为未关闭，不会发到飞书；之后再选群也**不会补发**，要等该设备恢复 `ONLINE` 后再出问题才会发卡片。
- [ ] 用一台测试 SN 推一条 `FAULT`，确认售后群收到告警卡片，再推一条 `ONLINE` 关闭它。
- [ ] 门户的 **Fault Analytics → Device monitoring** 里可以看到未关闭的告警和最近的事件，便于双方核对。

---

*接口实现见 `functions/api/routes/devices.ts`、`functions/lib/deviceAlerts.ts`、`functions/lib/deviceMonitor.ts`；测试见 `functions/test/devices.int.test.ts`。*
