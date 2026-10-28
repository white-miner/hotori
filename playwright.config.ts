import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "room-card-layout.spec.ts", workers: 1,
  use: { baseURL: "http://127.0.0.1:5199", channel: "chrome", headless: true },
  webServer: { command: "npm run dev -- --port 5199", url: "http://127.0.0.1:5199", reuseExistingServer: false, timeout: 30000 },
});
