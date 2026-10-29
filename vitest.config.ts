import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["functions/**/*.test.ts", "web/src/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
    // The *.int.test.ts suites each start a Miniflare D1 (a workerd process).
    // One worker keeps memory bounded; the suites are fast enough serially.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 20000
  }
});
