// The integration harness runs under Node (vitest), but the functions tsconfig
// only carries Workers types. Declare just the Node APIs the harness uses rather
// than pulling @types/node — and its globals — into the Workers type space.

declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}
