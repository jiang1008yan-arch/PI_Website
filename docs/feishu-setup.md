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
(the internal after-sales group's `chat_id`, `oc_…`), and optionally `ANTHROPIC_API_KEY` for AI suggestions.
Set `APP_BASE_URL` (e.g. `https://portal.example.com`) as a plain variable — links in bot messages use it.

The bot only acts when `FEISHU_APP_ID`, `FEISHU_APP_SECRET` and `FEISHU_SERVICE_CHAT_ID` are all set.

## 3. Day-to-day use

- Add the bot to the internal after-sales group and to each customer's external group.
- **The rule: @ the bot in a group = "make a ticket".** Agree this with after-sales and customers.
- **Create a ticket from a customer's message:** reply to that message and @ the bot. The bot sends you a private card with the
  message, an AI suggestion (if enabled) and a short form; nothing is created until you press **Create ticket**.
  A customer who @s the bot directly gets their message forwarded to the internal group as the same card.
- Direct messages to the bot never create tickets; the bot answers them with this usage hint.
- The customer group only ever sees "ticket registered" and "ticket resolved". Everything else stays in the internal group,
  where each ticket has one card (Take / status / note) that updates in place, and the ticket's sales person is @-mentioned on changes.
- The first time someone presses a card button the bot DMs them a one-time link to tie their Feishu account to their portal
  account. Only after-sales and admins can take or update tickets; sales can create them.

## 4. Trying it locally first (recommended)

Feishu must reach the server over public HTTPS. Instead of deploying (the deployed site shares the production
database), run the portal locally and expose it with a temporary Cloudflare tunnel. Only the local database is touched.

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
   ANTHROPIC_API_KEY=...   (optional — AI suggestions)
   ```
   The server must already have the Encrypt Key and Verification Token **before** you save the URLs in Feishu,
   because Feishu checks the URL immediately.
6. Save the event URL `https://<tunnel>/api/feishu/events` (add event 接收消息 v2.0) and the callback URL
   `https://<tunnel>/api/feishu/card` (add callback 卡片回传交互). Then create and publish an app version, limited to yourself.
7. Make two internal groups: an "after-sales" group and a "customer" group (a stand-in for an external group). Add the bot to both.
   Get the after-sales group's `chat_id` from the [API Explorer](https://open.feishu.cn/api-explorer) with
   **获取用户或机器人所在的群列表** (`GET /im/v1/chats`, tenant token) and put it in `FEISHU_SERVICE_CHAT_ID`; restart the server.
8. Try the flow (with a one-person account, the direct chat with the bot can be the after-sales "group" — put its `chat_id`,
   taken from the bot's first event, in `FEISHU_SERVICE_CHAT_ID` — but the customer side must be a real group, since only group
   @-mentions create tickets):
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

## 5. Verify in a test tenant before going live

Built against the documented formats and covered by automated tests with a fake Feishu API, but not yet run against real Feishu:

- Card JSON 2.0 forms (`form`, `select_static`, `input`, submit button with `behaviors: callback`) — check they render and submit.
- In-place card updates (`PATCH /im/v1/messages/:id`) for a card in a group.
- Encrypted pushes and signatures with your Encrypt Key.
- Feishu's **message shortcut** (消息快捷操作) was not used because its event format could not be confirmed; replying with @bot
  covers the same need. It can be added later as a second trigger.
