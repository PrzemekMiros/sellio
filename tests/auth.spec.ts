import { test, expect, type Page } from '@playwright/test';

const user = { id: 'user-1', email: 'seller@example.com', user_metadata: { full_name: 'Test Seller' }, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
function session(expired = false) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600);
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp, sub: user.id })).toString('base64url')}.signature`;
  return { access_token: token, refresh_token: expired ? 'old-refresh' : 'new-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user };
}
const store = { id: 'store-row', external_id: 'wp_test', name: 'Test store', site_url: 'https://shop.example.com', credentials: { backend_url: 'http://localhost:4323' } };
async function setup(page: Page, expired = false, legacy = false) {
  const saved: Record<string, unknown> = session(expired);
  if (legacy) delete saved.expires_at;
  await page.addInitScript(saved => {
    if (!sessionStorage.getItem('test-session-seeded')) {
      localStorage.setItem('sellio-auth-session', JSON.stringify(saved));
      sessionStorage.setItem('test-session-seeded', 'true');
    }
  }, saved);
  await page.route('https://sellio-test.supabase.co/auth/v1/user', route => route.fulfill({ json: user }));
  await page.route('https://sellio-test.supabase.co/rest/v1/stores?**', route => route.fulfill({ json: [store] }));
  await page.route('**/v1/admin/wordpress/stores/wp_test/products?**', route => route.fulfill({ json: { products: [{ id: '1', name: 'Persisted product', stock_quantity: 2 }], total: 1 } }));
}

test('renews an expired legacy session and loads products from the saved database connection', async ({ page }) => {
  await setup(page, true, true);
  let refreshes = 0;
  await page.route('https://sellio-test.supabase.co/auth/v1/token?grant_type=refresh_token', async route => {
    refreshes++;
    expect(route.request().postDataJSON().refresh_token).toBe('old-refresh');
    await route.fulfill({ json: session() });
  });
  await page.goto('/admin/produkty/lista');
  await expect(page.getByRole('button', { name: 'Persisted product' })).toBeVisible();
  expect(refreshes).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sellio-auth-session')!).refresh_token)).toBe('new-refresh');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Persisted product' })).toBeVisible();
  expect(refreshes).toBe(1);
});

test('retries a 401 once with a new token', async ({ page }) => {
  await setup(page);
  let requests = 0;
  let refreshes = 0;
  const fresh = { ...session(), access_token: session().access_token + '-renewed' };
  await page.route('https://sellio-test.supabase.co/auth/v1/token?grant_type=refresh_token', route => { refreshes++; return route.fulfill({ json: fresh }); });
  await page.route('**/v1/admin/wordpress/stores/wp_test/products?**', route => {
    requests++;
    return route.fulfill(requests === 1 ? { status: 401, json: {} } : { json: { products: [{ id: '1', name: 'Retried product' }], total: 1 } });
  });
  await page.goto('/admin/produkty/lista');
  await expect(page.getByRole('button', { name: 'Retried product' })).toBeVisible();
  expect(requests).toBe(2); expect(refreshes).toBe(1);
});

test('does not loop when the backend keeps rejecting the session', async ({ page }) => {
  await setup(page);
  let requests = 0;
  await page.route('https://sellio-test.supabase.co/auth/v1/token?grant_type=refresh_token', route => route.fulfill({ json: session() }));
  await page.route('**/v1/admin/wordpress/stores/wp_test/products?**', route => { requests++; return route.fulfill({ status: 401, json: {} }); });
  await page.goto('/admin/produkty/lista');
  await expect(page.locator('[data-products-feedback]')).toHaveText('Sesja wygasła. Zaloguj się ponownie.');
  expect(requests).toBe(2);
});

test('restores a connection missing from the old database save', async ({ page }) => {
  await setup(page);
  let restored = false;
  await page.route('https://sellio-test.supabase.co/rest/v1/stores?**', route => route.fulfill({ json: restored ? [store] : [] }));
  await page.route('**/v1/admin/wordpress/stores', route => { restored = true; return route.fulfill({ json: { restored: 1 } }); });
  await page.goto('/admin/produkty/lista');
  await expect(page.getByRole('button', { name: 'Persisted product' })).toBeVisible();
  expect(restored).toBe(true);
});

test('saves synchronization preferences in the database and restores after reload', async ({ page }) => {
  await setup(page);
  let saved = structuredClone(store) as typeof store & { credentials: Record<string, unknown> };
  await page.route('https://sellio-test.supabase.co/rest/v1/stores?**', async route => {
    if (route.request().method() === 'PATCH') saved = { ...saved, ...route.request().postDataJSON() };
    await route.fulfill({ json: [saved] });
  });
  await page.goto('/admin/produkty/import-eksport');
  await expect(page.locator('input[name="store_id"]')).toHaveValue('wp_test');
  await page.locator('input[name="sync_prices"]').uncheck();
  await page.getByRole('button', { name: 'Zapisz zasady synchronizacji' }).click();
  await expect(page.locator('[data-sync-feedback]')).toContainText('Zasady zapisane w bazie danych');
  await page.reload();
  await expect(page.locator('input[name="sync_prices"]')).not.toBeChecked();
  await expect(page.locator('input[name="sync_stock"]')).toBeChecked();
});

test('shows a database failure instead of claiming preferences were saved', async ({ page }) => {
  await setup(page);
  await page.route('https://sellio-test.supabase.co/rest/v1/stores?**', route => route.fulfill(route.request().method() === 'PATCH' ? { status: 503, json: {} } : { json: [store] }));
  await page.goto('/admin/produkty/import-eksport');
  await page.getByRole('button', { name: 'Zapisz zasady synchronizacji' }).click();
  await expect(page.locator('[data-sync-feedback]')).toContainText('Nie udało się zapisać zasad w bazie');
});

test('redirects to login only when the refresh token is revoked', async ({ page }) => {
  await setup(page, true);
  await page.route('https://sellio-test.supabase.co/auth/v1/token?grant_type=refresh_token', route => route.fulfill({ status: 400, json: { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } }));
  await page.goto('/admin/produkty/lista');
  await expect(page).toHaveURL('/logowanie');
});

test('account menu supports keyboard, outside click and mobile layout', async ({ page }) => {
  await setup(page);
  await page.goto('/admin');
  const trigger = page.getByRole('button', { name: 'Menu konta', exact: true });
  const dropdown = page.locator('#account-dropdown');
  const settings = dropdown.getByRole('link', { name: 'Ustawienia konta' });
  await expect(dropdown).toBeHidden();
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab'); await expect(settings).toBeFocused();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await expect(dropdown).toBeHidden();
  await page.keyboard.press('ArrowDown'); await expect(settings).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(dropdown.getByRole('button', { name: 'Wyloguj się' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dropdown).toBeHidden();
  await trigger.click(); await page.locator('main h1').click(); await expect(dropdown).toBeHidden();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const box = await dropdown.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/account-menu-${width}.png` });
    await trigger.click();
  }
  await trigger.click(); await settings.click();
  await expect(page).toHaveURL('/admin/ustawienia');
  await trigger.click(); await dropdown.getByRole('link', { name: 'Informacje', exact: true }).click();
  await expect(page).toHaveURL('/admin/pomoc-i-kontakt');
});

test('account logout clears the session and prevents returning to the panel', async ({ page }) => {
  await setup(page);
  let scope = '';
  await page.route('https://sellio-test.supabase.co/auth/v1/logout?**', route => {
    scope = new URL(route.request().url()).searchParams.get('scope') || '';
    return route.fulfill({ status: 204 });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Menu konta', exact: true }).click();
  await page.getByRole('button', { name: 'Wyloguj się', exact: true }).click();
  await expect(page).toHaveURL('/logowanie');
  expect(scope).toBe('local');
  expect(await page.evaluate(() => localStorage.getItem('sellio-auth-session'))).toBeNull();
  await page.goto('/admin');
  await expect(page).toHaveURL('/logowanie');
});
