import { test, expect } from '@playwright/test';
import { menuModules, modules } from '../src/config/modules';

test('pulpit, wszystkie adresy, odświeżenie i aktywne menu', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await expect(page.locator('nav a')).toHaveCount(menuModules.length);
  await expect(page.locator('.metric-value')).toHaveText(['—', '—', '—']);
  await expect(page.getByText('Zamówienia pojawią się po uruchomieniu integracji')).toBeVisible();
  for (const module of menuModules) {
    const link = page.locator(`nav a[href="${module.href}"]`);
    if (!(await link.isVisible())) await page.locator('nav details').filter({ has: page.locator(`a[href="${module.href}"]`) }).locator('summary').click();
    await link.click();
    await expect(page).toHaveURL(module.href);
    await expect(page.locator('nav [aria-current="page"]')).toHaveText(module.name);
    const response = await page.goto(module.href);
    expect(response?.status()).toBe(200);
    await page.reload();
    await expect(page.locator('nav [aria-current="page"]')).toHaveText(module.name);
    if (module.slug) {
      await expect(page.locator('main h1')).toHaveText(module.name);
      await expect(page.locator('.module-placeholder .neutral-badge')).toHaveText('W przygotowaniu');
      await expect(page.locator('main button, main input, main table')).toHaveCount(0);
    }
  }
  for (const module of modules.filter(item => !menuModules.some(current => current.href === item.href))) {
    expect((await page.goto(module.href))?.status()).toBe(200);
    await expect(page.locator('main h1')).toHaveText(module.name);
  }
  expect(errors).toEqual([]);
});

test('mobilne menu: klawiatura, pułapka fokusu, Escape, nawigacja i rozmiary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  const open = page.getByRole('button', { name: 'Otwórz menu' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Zamknij menu' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Sellio — pulpit' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('nav summary').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Sellio — pulpit' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  const orders = page.locator('summary').filter({ hasText: 'Zamówienia' });
  await orders.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Lista zamówień', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/admin/zamowienia/lista');
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await page.getByRole('link', { name: 'Integracje', exact: true }).click();
  await expect(page).toHaveURL('/admin/integracje');
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.integration-card')).toHaveCount(4);
  await open.click();
  await page.locator('#sidebar-overlay').click({ position: { x: 350, y: 300 } });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/admin', '/admin/integracje']) {
      await page.goto(route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/admin');
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true, animations: 'disabled' });
});
