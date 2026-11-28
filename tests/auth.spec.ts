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

test('Allegro connection setup is disabled until server credentials are configured', async ({ page }) => {
  await setup(page);
  await page.route('**/v1/admin/allegro/status', route => route.fulfill({ json: { configured: false, connected: false, account: null } }));
  await page.goto('/admin/integracje');
  await page.getByRole('link', { name: 'Konfiguruj Allegro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Połącz konto Allegro', exact: true })).toBeDisabled();
  await expect(page.locator('[data-allegro-setup]')).toBeVisible();
  await expect(page.locator('[data-allegro-state]')).toHaveText('Wymaga konfiguracji');
});

test('Allegro callback shows an actionable error and removes diagnostic parameters from the URL', async ({ page }) => {
  await setup(page);
  await page.route('**/v1/admin/allegro/status', route => route.fulfill({ json: { configured: true, connected: false, account: null } }));
  await page.goto('/admin/integracje?allegro=failed&allegro_error=profile_forbidden&allegro_ref=12345678-1234-1234-1234-123456789abc#allegro-connection');
  await expect(page.locator('[data-allegro-feedback]')).toContainText('HTTP 403');
  await expect(page.locator('[data-allegro-feedback]')).toContainText('User-Agent');
  await expect(page.locator('[data-allegro-feedback]')).toContainText('12345678-1234-1234-1234-123456789abc');
  await expect(page.getByRole('button', { name: 'Połącz konto Allegro', exact: true })).toBeEnabled();
  expect(new URL(page.url()).search).toBe('');
  await page.goto('/admin/integracje?allegro=failed&allegro_error=private-provider-error&allegro_ref=untrusted-secret');
  await expect(page.locator('[data-allegro-feedback]')).toContainText('Kod: internal');
  await expect(page.locator('[data-allegro-feedback]')).not.toContainText('untrusted-secret');
  await expect(page.locator('[data-allegro-feedback]')).not.toContainText('private-provider-error');
});

test('Allegro connected account persists in UI, API checks and disconnect errors remain honest', async ({ page }) => {
  await setup(page);
  const status = { configured: true, connected: true, account: { id: 'allegro-1', login: 'Firma-testowa' }, checkedAt: '2026-11-27T20:00:00Z' };
  await page.route('**/v1/admin/allegro/status', route => route.fulfill({ json: status }));
  await page.route('**/v1/admin/allegro/check', route => route.fulfill({ json: status }));
  await page.route('**/v1/admin/allegro/connection', route => route.fulfill({ status: 503, json: { error: 'Nie udało się odłączyć konta' } }));
  await page.goto('/admin/integracje?allegro=connected');
  await expect(page.locator('[data-allegro-login]')).toHaveText('Konto: Firma-testowa');
  await expect(page.locator('[data-allegro-feedback]')).toContainText('zapisane na serwerze');
  await page.getByRole('button', { name: 'Sprawdź połączenie', exact: true }).click();
  await expect(page.locator('[data-allegro-feedback]')).toContainText('Połączenie działa');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Odłącz od Sellio', exact: true }).click();
  await expect(page.locator('[data-allegro-feedback]')).toHaveText('Nie udało się odłączyć konta');
  await expect(page.locator('[data-allegro-state]')).toHaveText('Połączono');
  await page.reload();
  await expect(page.locator('[data-allegro-login]')).toHaveText('Konto: Firma-testowa');
  await page.goto('/admin/allegro/wystawianie');
  await expect(page.locator('[data-allegro-account-select]')).toContainText('Firma-testowa · Allegro.pl');
});

test('Allegro retains edits after a failed server save and restores a successful draft', async ({ page }) => {
  await setup(page);
  let failSave = true;
  let saved: Record<string, unknown> | null = null;
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts', route => route.fulfill({ json: { drafts: saved ? [saved] : [] } }));
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts/1', route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (failSave) return route.fulfill({ status: 503, json: { error: 'Serwer zapisu niedostępny' } });
    saved = { ...route.request().postDataJSON(), updatedAt: new Date().toISOString() };
    return route.fulfill({ json: { draft: saved } });
  });
  await page.goto('/admin/allegro/wystawianie');
  await page.getByRole('button', { name: 'Formularz wystawiania', exact: true }).click();
  await page.locator('[data-field=title]').fill('Szkic na serwerze');
  await page.getByRole('button', { name: 'Zapisz szkice', exact: true }).click();
  await expect(page.locator('[data-offer-feedback]')).toContainText('Serwer zapisu niedostępny');
  await expect(page.locator('[data-field=title]')).toHaveValue('Szkic na serwerze');
  await expect(page.getByRole('button', { name: 'Zapisz szkice', exact: true })).toBeEnabled();
  failSave = false;
  await page.getByRole('button', { name: 'Zapisz szkice', exact: true }).click();
  await expect(page.locator('[data-save-state]')).toHaveText('Wszystkie szkice zapisane na koncie');
  await page.reload();
  await page.getByRole('button', { name: 'Zapisane szkice' }).click();
  await page.getByRole('button', { name: 'Formularz wystawiania', exact: true }).click();
  await expect(page.locator('[data-field=title]')).toHaveValue('Szkic na serwerze');
});

test('Allegro does not offer new edits when existing drafts failed to load', async ({ page }) => {
  await setup(page);
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts', route => route.fulfill({ status: 503, json: { error: 'Nie udało się odczytać szkiców' } }));
  await page.goto('/admin/allegro/wystawianie');
  await expect(page.locator('[data-feedback]')).toHaveText('Nie udało się odczytać szkiców');
  await expect(page.locator('[data-products] tr')).toHaveCount(0);
  await expect(page.locator('[data-empty-title]')).toHaveText('Nie udało się wczytać magazynu');
  await expect(page.locator('[data-empty-import]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Odśwież', exact: true })).toBeEnabled();
});

test('Allegro collapses duplicate records for the same WooCommerce catalog and uses the Products connection', async ({ page }) => {
  await setup(page);
  const current = { ...store, name: 'Sklep WooCommerce', created_at: '2026-11-24T20:47:51Z' };
  const empty = { ...store, id: 'old-empty', external_id: 'wp_old', name: current.name, created_at: '2026-11-24T20:26:10Z' };
  await page.route('https://sellio-test.supabase.co/rest/v1/stores?**', route => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: query.get('limit') === '1' ? [current] : [empty, current] });
  });
  const items = Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), name: `Imported product ${index + 1}`, price: '12.00', stock_quantity: 2 }));
  await page.route('**/v1/admin/wordpress/stores/wp_test/products?**', route => route.fulfill({ json: { products: items, total: items.length } }));
  await page.route('**/v1/admin/wordpress/stores/wp_old/products?**', route => route.fulfill({ json: { products: [], total: 0 } }));
  await page.route('**/v1/admin/allegro/stores/*/drafts', route => route.fulfill({ json: { drafts: [] } }));
  await page.goto('/admin/produkty/lista');
  await expect(page.locator('[data-products-body] tr')).toHaveCount(20);
  await page.goto('/admin/allegro/wystawianie');
  await expect(page.locator('[data-store]')).toHaveValue(current.id);
  await expect(page.locator('[data-products] tr')).toHaveCount(20);
  await expect(page.locator('[data-total]')).toHaveText('20');
  await expect(page.locator('[data-empty]')).toBeHidden();
  await expect(page.locator('[data-store] option:checked')).toContainText('WooCommerce · Sklep WooCommerce');
  await expect(page.locator('[data-store] option')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-store]')).toHaveValue(current.id);
  await expect(page.locator('[data-products] tr')).toHaveCount(20);
});

test('Allegro bulk save spans filtered pages, preserves drafts and retries only failed products', async ({ page }) => {
  await setup(page);
  const items = Array.from({ length: 31 }, (_, index) => ({ id: String(index + 1), name: index < 30 ? `Batch ${index + 1}` : 'Other product', price: '12.00', stock_quantity: 2 }));
  const saved = new Map<string, any>([['1', { productId: '1', title: 'Custom draft title', price: '99.00', quantity: 4, categoryId: '', ean: '', description: '', images: [], condition: '', shippingRatesId: '', returnPolicyId: '', warrantyId: '', handlingTime: '' }]]);
  const calls: string[] = []; let fail = true;
  await page.route('**/v1/admin/wordpress/stores/wp_test/products?**', route => route.fulfill({ json: { products: items, total: items.length } }));
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts', route => route.fulfill({ json: { drafts: [...saved.values()] } }));
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!; calls.push(id);
    if (id === '2' && fail) return route.fulfill({ status: 503, json: { error: 'Temporary save failure' } });
    await new Promise(resolve => setTimeout(resolve, 10));
    saved.set(id, route.request().postDataJSON());
    return route.fulfill({ json: { draft: saved.get(id) } });
  });
  await page.goto('/admin/allegro/wystawianie');
  await page.locator('.al-filter-panel > summary').click();
  await page.getByLabel('Szukaj produktu').fill('Batch');
  await page.locator('[data-select-filtered]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-selected]')).toHaveText('Zaznaczono: 30');
  await page.locator('[data-run-batch]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-store]')).toBeDisabled();
  await expect(page.locator('[data-batch-summary]')).toContainText('Zapisano: 28. Pominięto: 1. Błędy: 1.');
  expect(calls).toHaveLength(29); expect(calls).not.toContain('1'); expect(calls).not.toContain('31');
  expect(saved.get('1').title).toBe('Custom draft title');
  fail = false; calls.length = 0;
  await page.locator('[data-retry-batch]').click();
  await expect(page.locator('[data-batch-summary]')).toContainText('Zapisano: 1. Pominięto: 0. Błędy: 0.');
  expect(calls).toEqual(['2']);
  await page.reload();
  await expect(page.locator('[data-draft-count]')).toHaveText('30');
  await page.getByRole('button', { name: 'Zapisane szkice' }).click();
  await expect(page.locator('[data-results]')).toContainText('25 z 30 pozycji');
  expect(items[0].price).toBe('12.00');
});

test('Allegro bulk edit validates common prices, saves zero quantity and deletes only confirmed drafts', async ({ page }) => {
  await setup(page);
  const items = [1, 2].map(id => ({ id: String(id), name: `Batch ${id}`, price: '12.00', stock_quantity: 2 }));
  const saved = new Map<string, any>(); let deletes = 0, failDelete = true;
  await page.route('**/v1/admin/wordpress/stores/wp_test/products?**', route => route.fulfill({ json: { products: items, total: 2 } }));
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts', route => route.fulfill({ json: { drafts: [...saved.values()] } }));
  await page.route('**/v1/admin/allegro/stores/wp_test/drafts/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    if (route.request().method() === 'DELETE') {
      deletes++;
      if (id === '2' && failDelete) return route.fulfill({ status: 503, json: { error: 'Temporary delete failure' } });
      saved.delete(id); return route.fulfill({ json: { deleted: true } });
    }
    saved.set(id, route.request().postDataJSON()); return route.fulfill({ json: { draft: saved.get(id) } });
  });
  await page.goto('/admin/allegro/wystawianie');
  await page.locator('[data-select-filtered]').evaluate((button: HTMLButtonElement) => button.click());
  await page.locator('[data-batch-action]').evaluate((select: HTMLSelectElement) => { select.value = 'edit'; });
  await page.locator('[data-run-batch]').evaluate((button: HTMLButtonElement) => button.click());
  await page.locator('[data-bulk] [name=price]').fill('25.50');
  await page.locator('[data-bulk] [name=percent]').fill('10');
  await page.locator('[data-bulk] button').click();
  await expect(page.locator('[data-feedback]')).toContainText('wybierz jedno pole');
  await expect(page.locator('[data-field=price]').first()).toHaveValue('12.00');
  await page.locator('[data-bulk] [name=percent]').fill('');
  await page.locator('[data-bulk] [name=quantity]').fill('0');
  await page.locator('[data-bulk] [name=condition]').selectOption('new');
  await page.locator('[data-bulk] button').click(); await page.locator('[data-save]').click();
  await expect(page.locator('[data-save-state]')).toHaveText('Wszystkie szkice zapisane na koncie');
  expect([...saved.values()].every(draft => draft.price === '25.50' && draft.quantity === 0 && draft.condition === 'new')).toBe(true);
  await page.locator('[data-back]').click();
  await page.locator('[data-batch-action]').evaluate((select: HTMLSelectElement) => { select.value = 'check'; });
  await page.locator('[data-run-batch]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-batch-summary]')).toContainText('Do poprawy: 2');
  await expect(page.locator('[data-batch-errors]')).toContainText('ilość');
  await page.locator('[data-batch-action]').evaluate((select: HTMLSelectElement) => { select.value = 'delete'; });
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('[data-run-batch]').evaluate((button: HTMLButtonElement) => button.click()); expect(deletes).toBe(0);
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-run-batch]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-batch-summary]')).toContainText('Usunięto: 1. Pominięto: 0. Błędy: 1.');
  await expect(page.locator('[data-draft-count]')).toHaveText('1');
  failDelete = false; page.once('dialog', dialog => dialog.accept()); await page.locator('[data-retry-batch]').click();
  await expect(page.locator('[data-batch-summary]')).toContainText('Usunięto: 1. Pominięto: 0. Błędy: 0.');
  expect(deletes).toBe(3);
  await page.reload(); await expect(page.locator('[data-draft-count]')).toHaveText('0');
  await expect(page.locator('[data-products] tr')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/allegro-bulk-mobile.png', fullPage: true });
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

test('order details show received data and update status only after a successful response', async ({ page }) => {
  await setup(page);
  const order = { id: '101', number: '101', status: 'processing', total: '123.00', currency: 'PLN', email: 'buyer@example.com', billing: { first_name: 'Test', last_name: 'Buyer' }, items: [{ name: 'Ordered lamp', sku: 'LAMP', quantity: 2, total: '100.00', total_tax: '23.00' }] };
  await page.route('**/v1/admin/wordpress/stores/wp_test/orders', route => route.fulfill({ json: { orders: [order, { ...order, id: '102', number: '102' }], total: 2 } }));
  let fail = true;
  await page.route('**/v1/admin/wordpress/stores/wp_test/orders/101/status', route => {
    if (fail) return route.fulfill({ status: 502, json: { error: 'Sklep jest niedostępny.' } });
    order.status = route.request().postDataJSON().status;
    return route.fulfill({ json: { order: { id: order.id, status: order.status } } });
  });
  await page.goto('/admin/zamowienia/lista');
  await page.getByRole('button', { name: 'Otwórz zamówienie 102', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Zamówienie #102');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Otwórz zamówienie 101', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('buyer@example.com');
  await expect(dialog).toContainText('Ordered lamp');
  await expect(dialog).toContainText('Brak danych adresowych.');
  await page.locator('#order-detail-status').selectOption('completed');
  await dialog.getByRole('button', { name: 'Zapisz status' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Sklep jest niedostępny.');
  await expect(page.locator('select[data-order-id="101"]')).toHaveValue('processing');
  fail = false;
  await dialog.getByRole('button', { name: 'Zapisz status' }).click();
  await expect(dialog.getByRole('status')).toContainText('został zmieniony w WooCommerce');
  await expect(page.locator('select[data-order-id="101"]')).toHaveValue('completed');
  await page.reload();
  await expect(page.locator('select[data-order-id="101"]')).toHaveValue('completed');
});
