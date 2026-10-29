# One Feishu transport: two bots, one client

Candidate 4 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).
Constraint: **existing behaviour stays the same.** The differences listed under Decision 4 are
not visible to users.

## Problem

The after-sales bot (`lib/feishu/client.ts`) and the PI Assistant (`lib/feishu/piBot/client.ts`)
each had their own Feishu client, and the copies had drifted apart:

| | after-sales bot | PI Assistant |
|---|---|---|
| Configuration | read `env.FEISHU_APP_ID` directly | an `app` object |
| Token cache | one slot, refreshed 60 s early | per app, refreshed 5 min early |
| Answer | `data.data` | the whole `data` |
| Errors | plain `Error`, no `res.ok` check | `FeishuApiError` with `code`, checks `res.ok` |
| Test fake | `setFeishuFetch` | `setPiBotFetch` |

About 80 lines were duplicated: the token, `call`, send card, send text and update card. On the
inbound side, signature checking was already shared (`crypto.readIncoming`). Each route still had
its own copy of reading the headers, event de-duplication, background tasks and `toast`.

**A correction to the review.** The review said the PI Assistant's identity lookup "lost the
openId fallback". That is not a bug. An `open_id` belongs to a single Feishu app, and
`users.feishuOpenId` stores the after-sales app's id, so an open_id from the PI app can never
match it. The PI bot now uses `userForFeishu` with its union id, purely for consistency.

## Decisions

1. **Transport.** `lib/feishu/transport.ts` is parameterized by `FeishuApp { bot, appId,
   appSecret }`. It provides:
   - one tenant-token cache per app, refreshed 5 minutes early;
   - `call(app, method, path, body?, bearer?)`, which returns Feishu's whole answer. `bearer`
     selects a user token or no token, as the OAuth calls need;
   - `download(app, path)` for files;
   - one error rule: an HTTP error or a `code` other than 0 throws `FeishuApiError`.
2. **Adapters.** The two bot clients become thin adapters over the transport. Every exported
   function keeps its name and signature, so no caller changes. `PiBotApp` gains `bot: "pi"`.
3. **One fake per bot.** The transport keeps one fetch override per bot. `setFeishuFetch` and
   `setPiBotFetch` keep their names, and each one replaces only its own bot's fetch and clears
   only that bot's tokens. Existing tests are unchanged.
4. **Error format.** `FeishuApiError` uses the after-sales format, `Feishu GET /path: <code>
   <msg>`. A failed token request reads `Feishu token: <code> <msg>`. This keeps the one error an
   admin sees unchanged: the requirement-pool check shows `Feishu refused: <message>`.
   Differences that users do not see:
   - The after-sales bot refreshes its token 5 minutes early instead of 60 seconds.
   - PI Assistant errors use the format above, but they only reach the logs.
   - The after-sales bot now also rejects HTTP errors that carry no `code` (it used to throw on a
     missing `code` instead). Feishu's IM and Bitable APIs always send a `code`.
5. **Inbound.** `lib/feishu/inbound.ts` holds `readFeishuRequest(c, secrets)`, `firstSeen`,
   `runLater(c, task, failure?)` and `toast`. Both routes use them. Each bot keeps its own
   secrets, event-key prefixes (`msg:`, `card:`, `pi:`) and log text.

## Tests

- Existing tests pass unmodified. The suites that cover the two bots end to end are
  `feishu.int`, `piAssistant.int`, `devices.int`, `lookup.int` and `scheduled.int`.
- New `functions/lib/feishu/transport.test.ts` covers:
  - tokens per app, reused, and refreshed 5 minutes before they expire;
  - one fake per bot: calls reach only their own bot's fake, and replacing a fake drops only that
    bot's token;
  - the whole answer is returned, and a user token or no token can replace the tenant token;
  - the error format for a non-zero code, for an HTTP error and for a refused token;
  - downloads.

## Rollout

Three steps on this branch. `npm test` and the typecheck must pass after each step.

1. Add `transport.ts` and its tests.
2. Turn both clients into adapters.
3. Add the inbound helpers, switch the PI bot to `userForFeishu`, and write this plan.

Commit locally only. No push.
