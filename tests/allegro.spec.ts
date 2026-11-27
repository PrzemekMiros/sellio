import { test, expect } from '@playwright/test';

async function catalog(page: import('@playwright/test').Page) {
  await page.goto('/admin/allegro/wystawianie');
  await expect(page.locator('[data-products] tr')).toHaveCount(1);
  await page.evaluate(() => {
    const key = 'sellio-local-preview-v1';
    const product = { id: 'led', name: 'Lampa LED', sku: 'LED-001', price: '120.00', currency: 'PLN', stock_quantity: 5, description: 'Lampa robocza', images: [], categories: [{ id: 'lights', name: 'Oświetlenie' }] };
    localStorage.setItem(key, JSON.stringify({ store: { id: 'local-store', external_id: 'wp_local', name: 'Sklep testowy', credentials: { backend_url: location.origin } },
      products: [product, { ...product, id: 'rope', name: 'Lina', sku: 'ROPE-002', price: '80.00', stock_quantity: 0, categories: [{ id: 'recovery', name: 'Wyciągarki' }] }], allegroDrafts: [] }));
  });
  await page.reload();
  await expect(page.locator('[data-products] tr')).toHaveCount(2);
}

test('filters, selection, bulk changes and drafts survive reload without changing catalog', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await catalog(page);
  await page.getByLabel('Szukaj produktu').fill('ROPE');
  await expect(page.locator('[data-products] tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
  await page.getByLabel('Dostępność', { exact: true }).selectOption('available');
  await expect(page.locator('[data-products] tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
  await page.getByLabel('Zaznacz produkty na tej stronie').check();
  await expect(page.locator('[data-selected]')).toHaveText('Zaznaczono: 2');
  await page.getByRole('button', { name: 'Wystaw zaznaczone (formularz)' }).click();
  await expect(page.locator('.al-offer')).toHaveCount(2);
  await page.locator('[data-bulk] [name=category]').fill('12345');
  await page.locator('[data-bulk] [name=percent]').fill('10');
  await page.locator('[data-bulk] button').click();
  await expect(page.locator('[data-product-id=led] [data-field=price]')).toHaveValue('132.00');
  await page.getByRole('button', { name: 'Zapisz szkice', exact: true }).click();
  await expect(page.locator('[data-save-state]')).toHaveText('Zapisano w lokalnym podglądzie');
  // Regression: editing a field again after saving must still update the live draft.
  await page.locator('[data-product-id=led] [data-field=title]').fill('Nowy tytuł lampy');
  await page.getByRole('button', { name: 'Zapisz szkice', exact: true }).click();
  await expect(page.locator('[data-save-state]')).toHaveText('Zapisano w lokalnym podglądzie');
  await page.reload();
  await page.getByRole('button', { name: 'Zapisane szkice' }).click();
  await expect(page.locator('[data-products] tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Formularz wystawiania', exact: true }).first().click();
  await expect(page.locator('[data-field=title]')).toHaveValue('Nowy tytuł lampy');
  await expect(page.locator('[data-field=categoryId]')).toHaveValue('12345');
  await expect(page.getByRole('button', { name: 'Opublikuj na Allegro' })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sellio-local-preview-v1')!).products[0].price)).toBe('120.00');
  expect(errors).toEqual([]);
});

test('validation, unsaved changes and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await catalog(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/allegro-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Formularz wystawiania', exact: true }).first().click();
  await page.locator('[data-field=price]').fill('-20');
  await page.getByRole('button', { name: 'Zapisz szkice', exact: true }).click();
  await expect(page.locator('[data-feedback]')).toContainText('Cena musi');
  await expect(page.locator('[data-save-state]')).toHaveText('Niezapisane zmiany');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Wróć do produktów' }).click();
  await expect(page.locator('[data-editor]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pagination retains selection across pages and dark mode renders', async ({ page }) => {
  await catalog(page);
  await page.evaluate(() => {
    const key = 'sellio-local-preview-v1', data = JSON.parse(localStorage.getItem(key)!);
    data.products = Array.from({ length: 105 }, (_, index) => ({ ...data.products[0], id: `item-${index}`, name: `Produkt ${String(index).padStart(3, '0')}` }));
    localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem('sellio-admin-theme', 'dark');
  });
  await page.reload();
  await expect(page.locator('[data-total]')).toHaveText('105');
  await page.getByLabel('Zaznacz produkty na tej stronie').check();
  await page.getByRole('button', { name: 'Następna strona' }).click();
  await page.getByLabel('Zaznacz produkty na tej stronie').check();
  await expect(page.locator('[data-selected]')).toHaveText('Zaznaczono: 50');
  await page.screenshot({ path: 'test-results/allegro-dark.png', fullPage: true });
  await page.evaluate(() => localStorage.setItem('sellio-admin-theme', 'light'));
  await page.reload();
  await page.screenshot({ path: 'test-results/allegro-desktop.png', fullPage: true });
});
