import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/perf/**/*.test.ts",
      "tests/perf/**/*.bench.ts",
    ],
    environment: "node",
  },
});
