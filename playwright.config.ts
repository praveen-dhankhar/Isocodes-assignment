import { defineConfig, devices } from "@playwright/test";

// e2e runs against the app with recorded samples only (EXTRACTION_MODE=sample): no network model calls.
// Needs a seeded database (`pnpm db:reset`) and SEED_DEMO_PASSWORD, read from .env.local when present.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI passes the variables directly
}

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { EXTRACTION_MODE: "sample", BETTER_AUTH_URL: `http://localhost:${PORT}` },
  },
});
