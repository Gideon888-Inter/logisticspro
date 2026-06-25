import { test, expect, Page } from '@playwright/test';

function testUsername() {
  return process.env.TEST_USERNAME || process.env.TEST_USER_EMAIL;
}

function testPassword() {
  return process.env.TEST_PASSWORD || process.env.TEST_USER_PASSWORD;
}

async function fillFirstVisible(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.fill(value);
      return;
    }
  }
  throw new Error(`No visible input found. Tried: ${selectors.join(', ')}`);
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return;
    }
  }
  throw new Error(`No visible clickable element found. Tried: ${selectors.join(', ')}`);
}

async function login(page: Page) {
  const username = testUsername();
  const password = testPassword();

  if (!username || !password) {
    throw new Error('TEST_USERNAME and TEST_PASSWORD are required.');
  }

  await page.goto('/');
  await fillFirstVisible(page, ["input[name='username']", "input[type='text']", "input[placeholder*='username' i]", "input[placeholder*='user' i]"], username);
  await fillFirstVisible(page, ["input[type='password']", "input[name='password']", "input[placeholder*='password' i]"], password);
  await clickFirstVisible(page, ["button[type='submit']", "button:has-text('LOGIN')", "button:has-text('Login')"]);
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function assertNoAppCrash(page: Page) {
  await expect(page.locator('body')).toBeVisible();
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const crashPatterns = [/application error/i, /runtime error/i, /uncaught/i, /cannot read/i, /undefined is not/i];
  for (const pattern of crashPatterns) {
    expect(bodyText).not.toMatch(pattern);
  }
}

async function clickVisibleButtons(page: Page, maxClicks = 30) {
  const startingUrl = page.url();
  const visibleIndexes: number[] = [];
  const count = await page.locator('button').count();

  for (let index = 0; index < count && visibleIndexes.length < maxClicks; index += 1) {
    const candidate = page.locator('button').nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    const isDisabled = await candidate.isDisabled().catch(() => false);
    if (isVisible && !isDisabled) {
      visibleIndexes.push(index);
    }
  }

  for (const index of visibleIndexes) {
    await page.goto(startingUrl);
    await page.waitForLoadState('domcontentloaded');
    const candidate = page.locator('button').nth(index);
    const label = (await candidate.innerText().catch(() => '')).trim() || 'button';

    await test.step(`click button: ${label.slice(0, 80)}`, async () => {
      const beforeUrl = page.url();
      await candidate.click({ timeout: 5_000 });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(500);
      await assertNoAppCrash(page);

      if (page.url() !== beforeUrl) {
        await page.goBack().catch(() => undefined);
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      }
    });
  }
}

test('Target page renders and visible buttons do not crash', async ({ page }) => {
  const targetPath = process.env.TARGET_PATH;

  if (!targetPath) {
    throw new Error('TARGET_PATH is required, for example /fleet');
  }

  await login(page);
  await page.goto(targetPath);
  await page.waitForLoadState('domcontentloaded');
  await assertNoAppCrash(page);
  await clickVisibleButtons(page, Number(process.env.MAX_BUTTON_CLICKS || 30));
});
