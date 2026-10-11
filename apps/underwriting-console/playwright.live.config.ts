import { defineConfig, devices } from '@playwright/test';

const liveAppUrl = requiredEnvironment('LIVE_APP_URL');
const phase = requiredEnvironment('LIVE_PHASE');
if (phase !== 'main' && phase !== 'cross-tenant') {
  throw new Error('LIVE_PHASE must be either "main" or "cross-tenant".');
}

const parsedUrl = new URL(liveAppUrl);
if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
  throw new Error('LIVE_APP_URL must use http or https.');
}
if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== '/') {
  throw new Error('LIVE_APP_URL must be an origin only, with no credentials, path, query, or fragment.');
}
const loopback = isLoopback(parsedUrl.hostname);
if (!loopback && parsedUrl.protocol !== 'https:') {
  throw new Error('Non-loopback LIVE_APP_URL targets must use https.');
}
if (phase === 'main' && !loopback
  && process.env.LIVE_ALLOW_REMOTE_SYNTHETIC_WRITES !== '1') {
  throw new Error('Remote main-phase execution requires LIVE_ALLOW_REMOTE_SYNTHETIC_WRITES=1.');
}

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 120_000 },
  reporter: 'line',
  use: {
    baseURL: parsedUrl.origin,
    acceptDownloads: true,
    actionTimeout: 120_000,
    navigationTimeout: 120_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live acceptance suite.`);
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
