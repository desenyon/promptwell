import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1,
  timeout: 20000, expect: { timeout: 5000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4177", headless: true, trace: "retain-on-failure", channel: process.env.PW_BROWSER_CHANNEL || undefined },
  webServer: { command: "node tests/browser/server.mjs", url: "http://127.0.0.1:4177", reuseExistingServer: false },
});
