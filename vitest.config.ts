import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["functions/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node"
  }
});
