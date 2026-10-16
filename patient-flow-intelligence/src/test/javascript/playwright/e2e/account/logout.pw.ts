import { accountMenuSelector, loginItemSelector, navbarSelector } from '../../support/commands';
import { expect, test } from '../../support/fixtures';

test.describe('logout', () => {
  test('go to home page when successfully logs out', async ({ page, jhi }) => {
    const { username, password } = jhi.credentials();
    const logout = page.waitForResponse(response => response.url().includes('/api/logout') && response.request().method() === 'POST');
    await jhi.login(username, password);
    await page.goto('');

    await jhi.navbar.clickOnLogoutItem();

    await logout;
    await page.locator(navbarSelector).locator(accountMenuSelector).click();
    await expect(page.locator(navbarSelector).locator(accountMenuSelector).locator(loginItemSelector)).toBeVisible();
  });
});
