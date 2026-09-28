import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const consoleDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './e2e-protected',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:3013', trace: 'on-first-retry' },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 3013',
    cwd: consoleDirectory,
    url: 'http://127.0.0.1:3013',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, VITE_FREEFLOW_RUNTIME_MODE: 'encompass-hosted' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
