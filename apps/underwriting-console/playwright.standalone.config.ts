import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const consoleDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './e2e-standalone',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3014',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'corepack pnpm exec vite --host 127.0.0.1 --port 3014',
    cwd: consoleDirectory,
    url: 'http://127.0.0.1:3014',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_FREEFLOW_RUNTIME_MODE: 'protected-web',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
