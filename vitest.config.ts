import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    env: { DEMO_REPLAY: "1", RENDER_LATENCY_SCALE: "0.02" },
  },
});
