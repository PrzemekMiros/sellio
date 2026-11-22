import { test, expect } from '@playwright/test';

test('jasny motyw domyślny, przełączanie i zapamiętanie wyboru', async ({ page }) => {
  await page.goto('/admin');
  const root = page.locator('html');
  const toggle = page.getByRole('button', { name: 'Tryb ciemny', exact: true });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.metric-card').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/admin-light.png', fullPage: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.metric-card').first()).toHaveCSS('background-color', 'rgb(25, 26, 32)');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Integracje', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.module-placeholder')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toggle.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
});

test('brak dostępu do pamięci przeglądarki nie blokuje przełącznika', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
  });
  await page.goto('/admin');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Tryb ciemny', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
