# Feishu bot setup

How to connect the after-sales Feishu bot (see [ADR 0002](adr/0002-feishu-as-after-sales-work-surface.md)).
Until the secrets below are set, the bot is off and the portal works exactly as before.

## 1. Create the app (Feishu admin)

1. In the [Feishu Open Platform](https://open.feishu.cn/app) create an **enterprise self-built app** (企业自建应用) and enable **Bot** (机器人).
2. Permissions (权限管理) — request these, nothing broader:
   - `im:message.group_at_msg:readonly` — receive messages that @ the bot in groups
   - `im:message.p2p_msg:readonly` — receive direct messages to the bot
   - `im:message:send_as_bot` — send and update messages as the bot
   - `im:message:readonly` — read the quoted customer message when staff reply with @bot
   The bot does **not** need the sensitive "read all group messages" permission.
3. To join customers' external groups, enable external sharing for the app (对外共享) — this needs admin review.
4. **Events & callbacks** (事件与回调), "send to developer server":
   - Event request URL: `https://<portal-domain>/api/feishu/events`, subscribe to **接收消息 v2.0** (`im.message.receive_v1`).
   - Callback request URL: `https://<portal-domain>/api/feishu/card`, subscribe to **卡片回传交互** (`card.action.trigger`).
   - Set an **Encrypt Key** and copy the **Verification Token**.
5. Publish a version of the app so the settings take effect.

## 2. Secrets and settings (Cloudflare Pages)

```bash
npx wrangler pages secret put FEISHU_APP_ID
```

Set the same way: `FEISHU_APP_SECRET`, `FEISHU_VERIFICATION_TOKEN`, `FEISHU_ENCRYPT_KEY`, `FEISHU_SERVICE_CHAT_ID`
(the internal after-sales group's `chat_id`, `oc_…`), and `AI_KEY_SECRET` — a long random string that encrypts the AI keys
people save for themselves (see section 3). Keep it stable: if it changes, everyone has to enter their AI key again.
Set `APP_BASE_URL` (e.g. `https://portal.example.com`) as a plain variable — links in bot messages use it.

The bot only acts when `FEISHU_APP_ID`, `FEISHU_APP_SECRET` and `FEISHU_SERVICE_CHAT_ID` are all set.

Two more shared secrets (long random strings):
- `CRON_SECRET` — lets the cron Worker run the scheduled jobs (next section).
- `DEVICE_INGEST_SECRET` — lets the charger backend push device status (section 3b).

## 2a. Scheduled jobs (cron Worker)

Cloudflare Pages cannot run anything on a timer, so a tiny separate Worker (`workers/cron`) calls
`POST /api/internal/cron` every 30 minutes (see [ADR 0003](adr/0003-cron-worker-for-pages.md)). Deploy it once:

```bash
npx wrangler deploy --config workers/cron/wrangler.toml
```

Then set its secret to the same value as the portal's `CRON_SECRET`, and put the portal's address in `PORTAL_URL`
in `workers/cron/wrangler.toml`:

```bash
npx wrangler secret put CRON_SECRET --config workers/cron/wrangler.toml
```

The jobs: purge expired PIs, retry failed Feishu pushes, grey out Feishu requests left for 6 hours, remind owners about
tickets not updated for 24 hours, the Monday summary, and device offline alerts. Locally, run them by hand:
`curl -X POST http://localhost:8788/api/internal/cron -H "x-cron-secret: <CRON_SECRET>"`.

## 3. Day-to-day use

- Add the bot to the internal after-sales group and to each customer's external group.
- **The rule: @ the bot in a group, or message it directly, when you want a ticket.** Agree this with after-sales and customers.
- The bot always asks first with a small card, "要把这条消息创建为售后工单吗？", with **创建工单** and **忽略**.
  Ignoring it costs nothing; casual messages simply get ignored.
- **Create a ticket from a customer's message:** reply to that message and @ the bot. You get the question card privately;
  **创建工单** turns it into a short form (with an AI suggestion, if enabled — AI runs only at this point), and nothing is created
  until you press **Create ticket**. A customer who @s the bot directly gets the question card in the internal group instead.
- The customer group only ever sees "ticket registered" and "ticket resolved".
- **Whoever creates a ticket owns it, and works it privately:** the ticket's card (status / note) is sent in a private message to its
  after-sales owner and updates in place; a hand-over moves the card to the new owner. The sales person gets private notes about
  changes. The after-sales group is not told about every ticket.
- **The after-sales group gets:** a summary every Monday from 9:00 Beijing time (last week's new / resolved tickets, every open ticket
  by owner, overdue ones in red, repeat faults), repeat-fault alerts, device alerts, and requests from customers who @ the bot.
- **Reminders:** an owner whose open ticket has not been updated for 24 hours gets one private reminder a day listing such tickets.
- **Requests expire:** a "create a ticket?" card or form not submitted within 6 hours turns grey; @ the bot again.
- **Find in the form:** type part of a production order, customer or SN and press **Find** to pick from what is already in the
  system; a production order or SN written in the message is filled in automatically.
- **Who is who:** both bots know a person by one Feishu identity (`union_id`), linked either by an admin entering the
  person's Feishu mobile number in Permission Management, or by the person signing in with Feishu once (portal username and
  password on first use). Someone unlinked who presses a card button, or sends **bind** to the bot, gets the "Sign in with
  Feishu" link. Only after-sales and admins create, take or update tickets; sales only read the tickets in their name.
- **Unreachable owner:** when a ticket's after-sales owner has not linked Feishu, the linked admins get a short notice.
- **Whoever creates a ticket owns it** (after-sales/admin as the after-sales owner, sales as the sales owner). Any after-sales can hand
  it over in the portal (ticket page → Assignees); every change is written to the ticket's activity and the new owner gets a Feishu DM.
- **Ticket type:** Fault / Product request / Question or other. It must be set before a ticket can be resolved (and a fault needs its
  fault type). Only faults count in Fault Analytics.
- **AI suggestions are optional and personal.** Each person who wants them saves their own key under the user menu →
  **AI Assistant**: Qwen (阿里云百炼 → API-KEY, default model `qwen-plus`) or DeepSeek (platform.deepseek.com, default model
  `deepseek-flash`). The key is checked, stored encrypted and only shown masked. AI runs only when that person presses **创建工单**,
  and suggests a summary, the ticket type and the fault type; nothing is applied until they press **Create ticket**.

## 3a. Product requests → the requirement pool (Feishu Bitable)

Product managers keep their requirement pool in a Feishu Bitable; each ticket classified as a **Product request** is added there once.

1. In the Feishu Open Platform, add the permission `bitable:app` to the app and publish a new version.
2. A product manager creates a Bitable with one table whose columns are exactly (all of type Text / 文本):
   工单号、提交日期、客户、产品、型号、SN、摘要、客户原话、售后负责人、工单链接.
3. In the base, **Share** → add the app **售后工单Robot** as an editor (可编辑).
4. Open the table, copy the link from the address bar (`…/base/<id>?table=tbl…`), and paste it in the portal under
   **Administration → Requirement Pool**; press **Check table** — it lists missing or wrongly typed columns.
5. To notify product managers, use the base's own **Automations → When a record is added → Send a Feishu message**.
   Filtering, exporting and assigning requests are all done in Bitable.

## 3b. Device status from the charger backend

The charger backend pushes device status by SN; nothing has to be registered first.

```
POST https://<portal>/api/devices/status
x-device-token: <DEVICE_INGEST_SECRET>
content-type: application/json

{ "events": [
  { "serialNumber": "CHG-0901-0001", "status": "FAULT", "faultCode": "E12", "faultText": "RCD tripped",
    "occurredAt": "2026-10-20T08:00:00Z" },
  { "serialNumber": "CHG-0901-0002", "status": "ONLINE" }
] }
```

- `status` is `ONLINE`, `OFFLINE` or `FAULT`; `occurredAt` is ISO 8601 (defaults to now); up to 500 events per request.
  A single event object or a bare array also works. The reply lists accepted / rejected events and alerts raised.
- A **fault** raises an alert at once; **offline** raises one after 2 hours (checked by the scheduled job). One alert per SN until
  it reports `ONLINE` again.
- Alerts go to the after-sales group with the SN, customer, production order and PI (when the SN is registered on an approved PI)
  and **创建工单**: whoever presses it fills in the form (already holding SN / order / customer) and owns the ticket.
- Fault Analytics → **Device monitoring** shows open alerts (and their tickets) and the latest events.

## 4. Trying it locally first (recommended)

**Easiest: long connection, no public address.** Feishu can deliver events and card clicks over a connection the
portal opens *to* Feishu. `npm run dev:feishu` runs that bridge (`scripts/feishu-dev-bridge.mjs`, official SDK) for both
bots and forwards everything to the local portal. In each app's **Events & callbacks**, choose
"使用长连接接收事件 / 回调" (long connection) for both events and callbacks — the bridge must be running when you save,
Feishu checks the connection. Put only the app id, secret and Verification Token in `.dev.vars` (leave the Encrypt Key
empty: long-connection events arrive decrypted). Card links and "Sign in with Feishu" then point at
`http://localhost:8788`, which works on the computer running the portal. Steps 7–9 below apply unchanged.

**Alternative: a public tunnel.** Feishu must then reach the server over public HTTPS. Instead of deploying (the deployed
site shares the production database), run the portal locally and expose it with a temporary Cloudflare tunnel. Only
the local database is touched — but anyone with the tunnel address can reach the local portal while it runs.

1. Install the tunnel tool once: `winget install --id Cloudflare.cloudflared`.
2. Local portal with test data: `npm run db:migrate:local`, `node scripts/seed-local-dev.mjs`, `npm run build`, `npm run dev:api` (port 8788).
3. In another terminal: `cloudflared tunnel --url http://localhost:8788` — it prints an `https://….trycloudflare.com` address.
   The address changes every time you restart it; update `APP_BASE_URL` and both Feishu URLs when it does.
4. Create the Feishu app (section 1, steps 1–2; the external-sharing step can wait — test with internal groups).
   Under **Events & callbacks → Encryption**, generate an Encrypt Key and note the Verification Token.
5. Put the values into `.dev.vars` (never committed) and restart `npm run dev:api`:
   ```
   FEISHU_APP_ID=cli_...
   FEISHU_APP_SECRET=...
   FEISHU_VERIFICATION_TOKEN=...
   FEISHU_ENCRYPT_KEY=...
   FEISHU_SERVICE_CHAT_ID=oc_...
   APP_BASE_URL=https://<your-tunnel>.trycloudflare.com
   AI_KEY_SECRET=<a long random string>   (lets people save their own AI keys)
   ```
   The server must already have the Encrypt Key and Verification Token **before** you save the URLs in Feishu,
   because Feishu checks the URL immediately.
6. Save the event URL `https://<tunnel>/api/feishu/events` (add event 接收消息 v2.0) and the callback URL
   `https://<tunnel>/api/feishu/card` (add callback 卡片回传交互). Then create and publish an app version, limited to yourself.
7. Make two internal groups: an "after-sales" group and a "customer" group (a stand-in for an external group). Add the bot to both.
   Get the after-sales group's `chat_id` from the [API Explorer](https://open.feishu.cn/api-explorer) with
   **获取用户或机器人所在的群列表** (`GET /im/v1/chats`, tenant token) and put it in `FEISHU_SERVICE_CHAT_ID`; restart the server.
8. Try the flow (with a one-person account, the direct chat with the bot can stand in for the after-sales group — put its
   `chat_id`, taken from the bot's first event, in `FEISHU_SERVICE_CHAT_ID` — and a small group with just you and the bot
   for the customer group):
   - In the customer group, post a message like "PO-2026-0901 charger keeps going offline", then **reply** to it with `@bot`.
   - The bot DMs you a confirmation card. Pressing its button the first time gets you a link-your-account DM: open it,
     sign in as `service_dev` (local test account), press **Link**, then press the card button again.
   - Fill in contact (and customer, production order, fault type) → **Create ticket**. Expect: a ticket card in the after-sales group,
     a "registered" reply in the customer group, and the ticket at `http://localhost:8788/tickets`.
   - On the group card: **Take**, then add a note, then set **Resolved**. The card should update in place, and the customer group
     should get only the "resolved" message. Changing the status in the portal should update the card too.
9. If a card button shows an error code, see the code table in Feishu's
   [card callback docs](https://open.feishu.cn/document/feishu-cards/card-callback-communication) (e.g. 200671 = server error,
   200673 = bad card JSON) and check the `npm run dev:api` terminal output.

## 4a. The PI Assistant bot (ZH PI approvals)

A second self-built app, separate from the after-sales bot. It sends each approval step's card to the approver the
submitter picked (presales, then commerce), takes **Approve** / **Reject (reason)** from the card, closes earlier
cards, and tells the submitter the result. Its "Edit on website" link signs people in with Feishu.

1. Create a self-built app (e.g. "PI Assistant") with **Bot**, and request: `im:message`, `im:message:send_as_bot`,
   `im:message.p2p_msg:readonly`, `im:message:update`, and **通过手机号或邮箱获取用户 ID** (`contact:user.id:readonly`)
   with the contacts data range set to all staff — the portal uses it to link people from their mobile number.
2. **Security settings → Redirect URL**: `https://<portal-domain>/api/auth/feishu/callback`
   (locally: `http://localhost:8788/api/auth/feishu/callback`).
3. **Events & callbacks**: event 接收消息 v2.0 and callback 卡片回传交互 — "send to developer server" with request URL
   `https://<portal-domain>/api/feishu/pi/events` for both, or long connection locally (section 4).
4. Secrets: `FEISHU_PI_APP_ID`, `FEISHU_PI_APP_SECRET`, `FEISHU_PI_VERIFICATION_TOKEN`, `FEISHU_PI_ENCRYPT_KEY`
   (set the encrypt key in production; leave it empty with the local long-connection bridge).
5. Publish a version. Link people either by entering their Feishu mobile number in **Permission Management** (automatic)
   or by having them **Sign in with Feishu** once (login page or the card's "Edit on website").

People are identified by `union_id` (the same in every company app), and the after-sales bot uses the same link. When
the approver of a step is not picked or not linked, the card goes to every linked admin with a note saying who should
have had it; admins may act at every step.

## 5. Verify in a test tenant before going live

Built against the documented formats and covered by automated tests with a fake Feishu API, but not yet run against real Feishu:

- Card JSON 2.0 forms (`form`, `select_static`, `input`, submit button with `behaviors: callback`) — check they render and submit.
- In-place card updates (`PATCH /im/v1/messages/:id`) for a card in a group.
- Encrypted pushes and signatures with your Encrypt Key.
- Feishu's **message shortcut** (消息快捷操作) was not used because its event format could not be confirmed; replying with @bot
  covers the same need. It can be added later as a second trigger.
