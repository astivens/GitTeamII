import { defineConfig, devices } from "@playwright/test";

/**
 * The harness runs the real frontend in Chromium against a fake Tauri IPC
 * boundary (`e2e/fixtures/tauri-mock.ts`). See `odd/tasks/e2e-harness.md` for
 * why a true `tauri-driver` run is not the harness of record here.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
