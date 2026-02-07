import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    headless: false, // Chrome extensions need non-headless mode
  },
});
