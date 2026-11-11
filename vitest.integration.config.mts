import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real MySQL/MariaDB server.
 * Requires TEST_DB_HOST/PORT/USER/PASSWORD for an account that may CREATE and
 * DROP databases named uci_test_* (each run uses a fresh database).
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    alias: { "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname },
  },
});
