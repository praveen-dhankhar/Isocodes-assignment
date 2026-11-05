import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Local runs read .env.local (CI sets the variables itself); variables already set win.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": at("./src"),
      // `server-only` throws outside a react-server bundle; its own empty build is the stub.
      "server-only": at("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    // ARCHITECTURE §6.5: `pnpm test --coverage src/domain` must keep ≥ 95% lines on the pure domain.
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      exclude: ["src/domain/**/*.test.ts", "src/domain/**/__fixtures__/**"],
      thresholds: { lines: 95 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          // The app's env() reads DATABASE_URL; point it at the test database, never the dev one.
          env: { DATABASE_URL: process.env.DATABASE_URL_TEST ?? "" },
          globalSetup: ["./vitest.integration-setup.ts"],
          fileParallelism: false, // one database; files share it
        },
      },
    ],
  },
});
