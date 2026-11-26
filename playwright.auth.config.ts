import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'auth.spec.ts',
  use: { baseURL: 'http://localhost:4323', headless: true, channel: 'chromium' },
  webServer: {
    command: 'npm run dev -- --port 4323 --ignore-lock', url: 'http://localhost:4323/logowanie',
    env: { PUBLIC_SUPABASE_URL: 'https://sellio-test.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', PUBLIC_LOCAL_PREVIEW: 'false' },
  },
});
