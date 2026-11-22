import { test, expect } from '@playwright/test';

test('landing: sekcje, linki, demo, responsywność i menu klawiaturą', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/'))?.status()).toBe(200);
  await expect(page).toHaveURL('/');
  await expect(page.locator('h1')).toHaveText('Allegro i Wordpressw jednym panelu');
  await expect(page.locator('.feature-section')).toHaveCount(4);
  await expect(page.locator('.module-tile')).toHaveCount(13);
  await expect(page.locator('.integration-tiles article')).toHaveCount(4);
  const links = await page.locator('a').evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('href')!))]);
  for (const href of links) {
    if (href.startsWith('#')) await expect(page.locator(href)).toHaveCount(1);
    else expect((await page.request.get(href)).status(), href).toBe(200);
  }
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true, animations: 'disabled' });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true, animations: 'disabled' });
  const toggle = page.locator('.mobile-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('#landing-mobile a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.locator('#landing-mobile a').first().click();
  await expect(page).toHaveURL('/#funkcje');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Otwórz demo panelu', exact: true }).click();
  await expect(page).toHaveURL('/admin');
  await expect(page.locator('.metric-value')).toHaveText(['—', '—', '—']);
  expect(errors).toEqual([]);
});
