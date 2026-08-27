import { defineConfig } from "vitest/config";

/**
 * End-to-end tests are kept out of `npm test`: they need the .NET SDK, run a
 * real dotnet build and a browser, and take minutes rather than milliseconds.
 */
export default defineConfig({
  test: {
    include: ["tests-e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    // One browser and one preview port, so the suites cannot race each other.
    fileParallelism: false,
  },
});
