import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testIgnore: ['auth.spec.ts', '**/*.test.ts'],
  use: { baseURL: 'http://localhost:4321', headless: true, channel: 'chromium' },
  webServer: { command: 'npm run dev', url: 'http://localhost:4321/admin', reuseExistingServer: !process.env.CI },
});
