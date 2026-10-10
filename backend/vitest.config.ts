import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [{ find: /^(?:\.\.?\/)+(?:src\/)?shared\.js$/, replacement: resolve(__dirname, "../shared/src/index.ts") }],
  },
  test: { include: ["test/**/*.test.ts"] },
});
