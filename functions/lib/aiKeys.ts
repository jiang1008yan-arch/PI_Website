// Encryption for users' own AI provider keys. The master secret (AI_KEY_SECRET)
// is a server secret kept apart from the database; each key is sealed with
// AES-256-GCM under a fresh IV and bound to its user id as additional data, so
// a ciphertext copied onto another user's row will not decrypt. Keys are only
// decrypted at the moment an AI request is made.

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function masterKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("pi-website-ai-keys"), info: encoder.encode("user-ai-key-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export type SealedKey = { cipher: string; iv: string };

export async function sealApiKey(secret: string, userId: string, apiKey: string): Promise<SealedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(userId) },
    await masterKey(secret),
    encoder.encode(apiKey)
  );
  return { cipher: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

// Throws if the secret, the user id or the ciphertext does not match.
export async function openApiKey(secret: string, userId: string, sealed: SealedKey): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: encoder.encode(userId) },
    await masterKey(secret),
    fromBase64(sealed.cipher)
  );
  return new TextDecoder().decode(plain);
}

// What the portal shows instead of the key.
export function maskApiKey(last4: string): string {
  return `sk-****${last4}`;
}
