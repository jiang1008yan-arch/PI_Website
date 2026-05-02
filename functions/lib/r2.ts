import type { Env } from "./types";

export function objectUrl(key: string) {
  return `/api/files/${encodeURIComponent(key)}`;
}

export async function putObject(env: Env, key: string, request: Request) {
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  await env.FILES.put(key, request.body, { httpMetadata: { contentType } });
}

export async function getObject(env: Env, key: string) {
  const obj = await env.FILES.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
}
