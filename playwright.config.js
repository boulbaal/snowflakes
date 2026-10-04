// E2E-tests tegen wrangler dev (lokale D1, test-login via .dev.vars).
const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const chromiumPad = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8788',
    launchOptions: chromiumPad ? { executablePath: chromiumPad } : {},
  },
  webServer: {
    command: 'npm run db:local && npm run dev',
    url: 'http://localhost:8788/api/version',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'telefoon', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'nl-BE' } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 }, locale: 'en-GB' } },
  ],
});
