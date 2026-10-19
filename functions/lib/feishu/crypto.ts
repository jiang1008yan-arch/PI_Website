// Verifying and decrypting what Feishu pushes to us (events and card
// callbacks share one scheme). With an Encrypt Key configured, Feishu sends
// {"encrypt": base64(iv ‖ AES-256-CBC(json))} with key = SHA-256(encryptKey),
// and signs the raw body: X-Lark-Signature = sha256(timestamp + nonce +
// encryptKey + body). Without one, only the Verification Token in the payload
// authenticates the request.

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Constant-time comparison of two hex strings.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(
  headers: { timestamp: string | null; nonce: string | null; signature: string | null },
  rawBody: string,
  encryptKey: string
): Promise<boolean> {
  if (!headers.timestamp || !headers.nonce || !headers.signature) return false;
  const expected = await sha256Hex(headers.timestamp + headers.nonce + encryptKey + rawBody);
  return safeEqual(expected, headers.signature.toLowerCase());
}

export async function decryptPayload(encrypted: string, encryptKey: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(encryptKey));
  const data = base64ToBytes(encrypted);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: data.slice(0, 16) }, key, data.slice(16));
  return new TextDecoder().decode(plain);
}

export type FeishuSecrets = { verificationToken?: string; encryptKey?: string };

export type Incoming = { ok: true; payload: any } | { ok: false; reason: string };

// Authenticates and decodes one pushed request. Fails closed: with neither an
// Encrypt Key nor a Verification Token configured nothing is accepted.
export async function readIncoming(
  rawBody: string,
  headers: { timestamp: string | null; nonce: string | null; signature: string | null },
  secrets: FeishuSecrets
): Promise<Incoming> {
  if (!secrets.encryptKey && !secrets.verificationToken) return { ok: false, reason: "Feishu is not configured" };
  let outer: any;
  try {
    outer = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "Invalid JSON" };
  }
  let payload = outer;
  if (typeof outer?.encrypt === "string") {
    if (!secrets.encryptKey) return { ok: false, reason: "Encrypted payload but no Encrypt Key configured" };
    // Signed pushes are checked; the URL-verification handshake arrives unsigned.
    if (headers.signature && !(await verifySignature(headers, rawBody, secrets.encryptKey))) {
      return { ok: false, reason: "Bad signature" };
    }
    try {
      payload = JSON.parse(await decryptPayload(outer.encrypt, secrets.encryptKey));
    } catch {
      return { ok: false, reason: "Cannot decrypt payload" };
    }
  } else if (secrets.encryptKey && headers.signature && !(await verifySignature(headers, rawBody, secrets.encryptKey))) {
    return { ok: false, reason: "Bad signature" };
  }
  if (secrets.verificationToken) {
    const token = payload?.header?.token ?? payload?.token;
    if (token !== secrets.verificationToken) return { ok: false, reason: "Bad verification token" };
  }
  return { ok: true, payload };
}
