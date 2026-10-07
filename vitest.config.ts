import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["src/lib/followup/__tests__/setup.ts"],
    testTimeout: 20000,
  },
});
