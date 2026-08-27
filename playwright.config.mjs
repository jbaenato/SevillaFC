import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: false,
    timeout: 15000
  }
});
