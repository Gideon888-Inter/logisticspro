import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type WorkflowStep =
  | { action: 'goto'; path: string }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'expectVisible'; selector: string }
  | { action: 'expectVisibleAny'; selectors: string[] }
  | { action: 'expectText'; selector: string; contains: string }
  | { action: 'expectTitleOrUrl'; contains: string }
  | { action: 'login' };

type Workflow = {
  name: string;
  requiresAuth?: boolean;
  steps: WorkflowStep[];
};

const workflowPath = process.env.WORKFLOWS_FILE || path.join(__dirname, '..', 'workflows.example.json');
const workflows = JSON.parse(fs.readFileSync(workflowPath, 'utf-8')) as Workflow[];

function hasAuthCredentials() {
  return Boolean(process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD);
}

async function login(page: Page) {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD are required for authenticated workflows.');
  }

  await page.goto('/login');

  const emailSelectors = ["input[type='email']", "input[name='email']", "input[placeholder*='email' i]"];
  const passwordSelectors = ["input[type='password']", "input[name='password']", "input[placeholder*='password' i]"];

  await fillFirstVisible(page, emailSelectors, email);
  await fillFirstVisible(page, passwordSelectors, password);

  const submitCandidates = [
    "button[type='submit']",
    "button:has-text('Sign in')",
    "button:has-text('Login')",
    "button:has-text('Log in')"
  ];

  await clickFirstVisible(page, submitCandidates);
  await page.waitForLoadState('networkidle').catch(() => undefined);
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

async function runStep(page: Page, step: WorkflowStep) {
  switch (step.action) {
    case 'goto':
      await page.goto(step.path);
      await page.waitForLoadState('domcontentloaded');
      return;

    case 'click':
      await page.locator(step.selector).first().click();
      return;

    case 'fill':
      await page.locator(step.selector).first().fill(step.value);
      return;

    case 'expectVisible':
      await expect(page.locator(step.selector).first()).toBeVisible();
      return;

    case 'expectVisibleAny': {
      for (const selector of step.selectors) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) {
          expect(true).toBeTruthy();
          return;
        }
      }
      throw new Error(`None of these selectors became visible: ${step.selectors.join(', ')}`);
    }

    case 'expectText':
      await expect(page.locator(step.selector).first()).toContainText(step.contains);
      return;

    case 'expectTitleOrUrl': {
      if (!step.contains) {
        expect(page.url()).toBeTruthy();
        return;
      }
      const title = await page.title();
      const url = page.url();
      expect(`${title} ${url}`).toContain(step.contains);
      return;
    }

    case 'login':
      await login(page);
      return;
  }
}

for (const workflow of workflows) {
  test(workflow.name, async ({ page }) => {
    test.skip(
      Boolean(workflow.requiresAuth && (process.env.SKIP_AUTH_WORKFLOWS === '1' || !hasAuthCredentials())),
      'Authenticated workflow skipped because TEST_USER_EMAIL and TEST_USER_PASSWORD are not configured.'
    );

    for (const step of workflow.steps) {
      await test.step(`${step.action}`, async () => {
        await runStep(page, step);
      });
    }
  });
}
