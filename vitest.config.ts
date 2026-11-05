import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
        },
      },
    ],
  },
});
