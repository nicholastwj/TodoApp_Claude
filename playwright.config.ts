import { defineConfig, devices } from '@playwright/test';

// E2E tests run against a production build on a dedicated port with a separate
// database file, so they never touch your dev server or your real todos.db.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts$/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    timezoneId: 'Asia/Singapore', // match the app's timezone
    locale: 'en-SG',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      DATABASE_PATH: 'todos.test.db',
      JWT_SECRET: 'playwright-test-secret-not-for-production',
      COOKIE_SECURE: 'false',
    },
  },
});
