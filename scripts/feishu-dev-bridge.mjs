// Local development bridge for the Feishu bots — no public URL needed.
//
// Feishu "long connection" mode: this script opens an OUTBOUND WebSocket to
// Feishu per bot (official SDK), receives events and card button clicks, and
// forwards each one unchanged to the local site, returning the site's JSON
// answer (toast + updated card) back to Feishu:
//   after-sales bot  messages → POST /api/feishu/events, card clicks → POST /api/feishu/card
//   PI Assistant     everything → POST /api/feishu/pi/events
//
// Production does not use this: there Feishu calls the deployed site over
// HTTPS ("send events to developer server" mode) with signing/encryption.
//
// Usage: npm run dev:api   (in one terminal)
//        npm run dev:feishu (in another)
// Reads FEISHU_APP_ID / FEISHU_APP_SECRET (after-sales bot) and
// FEISHU_PI_APP_ID / FEISHU_PI_APP_SECRET (PI Assistant) from .dev.vars. Leave
// the *_ENCRYPT_KEY values empty locally: long-connection events arrive
// decrypted and unsigned, and the site checks the *_VERIFICATION_TOKEN instead
// (which the bridge adds to message events, since Feishu omits it on this path).
// Secret values are never printed.
import { readFileSync } from "node:fs";
import * as Lark from "@larksuiteoapi/node-sdk";

const SITE = process.env.SITE_URL ?? "http://localhost:8788";

function readDevVars() {
  const vars = {};
  for (const line of readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const vars = readDevVars();
const bots = [
  { key: "service", prefix: "FEISHU_", route: (type) => (type === "card.action.trigger" ? "/api/feishu/card" : "/api/feishu/events") },
  { key: "pi", prefix: "FEISHU_PI_", route: () => "/api/feishu/pi/events" }
];

let started = 0;
for (const bot of bots) {
  const appId = vars[bot.prefix + "APP_ID"];
  const appSecret = vars[bot.prefix + "APP_SECRET"];
  if (!appId || !appSecret || !/^cli_[0-9a-f]{16}$/i.test(appId)) {
    console.log(`[${bot.key}] skipped: ${bot.prefix}APP_ID / APP_SECRET not set in .dev.vars`);
    continue;
  }
  if (vars[bot.prefix + "ENCRYPT_KEY"]) {
    console.log(`[${bot.key}] note: ${bot.prefix}ENCRYPT_KEY is set; long-connection events arrive decrypted and unsigned, so leave it empty for local bridge testing`);
  }

  const forward = {
    // The SDK hands us the full Feishu v2 envelope ({schema, header, event}).
    async invoke(envelope) {
      const type = envelope?.header?.event_type ?? envelope?.type;
      // Chat ids are not secret and are needed for FEISHU_SERVICE_CHAT_ID.
      const message = envelope?.event?.message;
      if (message?.chat_id) console.log(`[${bot.key}] message in ${message.chat_type} chat ${message.chat_id}`);
      // Long-connection message events carry no verification token (the
      // connection itself is authenticated by the app secret). The site still
      // checks it, so stamp the configured one on before forwarding.
      const configuredToken = vars[bot.prefix + "VERIFICATION_TOKEN"];
      if (envelope?.header && !envelope.header.token && configuredToken) envelope.header.token = configuredToken;
      try {
        const res = await fetch(`${SITE}${bot.route(type)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope)
        });
        const text = await res.text();
        console.log(`[${bot.key}] ${type} -> ${res.status}`);
        if (res.status === 401) {
          // Diagnose without printing secrets: does the event's token match .dev.vars?
          const sent = String(envelope?.header?.token ?? envelope?.token ?? "");
          console.log(`[${bot.key}] rejected: ${text}; event token ${sent ? `${sent.length} chars` : "missing"}, matches ${bot.prefix}VERIFICATION_TOKEN: ${sent === (configuredToken ?? "")}`);
        }
        return text ? JSON.parse(text) : undefined;
      } catch (error) {
        console.error(`[${bot.key}] ${type} forward failed:`, error.message);
        return undefined;
      }
    }
  };

  const client = new Lark.WSClient({ appId, appSecret, loggerLevel: Lark.LoggerLevel.warn });
  await client.start({ eventDispatcher: forward });
  console.log(`[${bot.key}] connected to Feishu (app ${appId}); forwarding to ${SITE}`);
  started++;
}

if (!started) {
  console.log("No Feishu app configured. Add FEISHU_APP_ID/FEISHU_APP_SECRET and/or FEISHU_PI_APP_ID/FEISHU_PI_APP_SECRET to .dev.vars.");
  process.exit(1);
}
