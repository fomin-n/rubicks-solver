import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  webServer: [
    {
      command: "RUBICKS_SOLVER_CACHE_DIR=../.cache uv run --project ../backend uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8000",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    { command: "npm run dev", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

