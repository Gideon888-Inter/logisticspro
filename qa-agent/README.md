# LogisticsPro QA Workflow Testing Agent

This folder contains a browser workflow testing agent for LogisticsPro using Playwright.

The goal is to validate complete user workflows, not just isolated functions. It can check that pages load, forms are usable, navigation works, and authenticated workflows still behave correctly after changes.

## What it does

- Runs browser-based workflow tests against a local or staging app URL.
- Stores workflows in JSON so new flows can be added without rewriting test code.
- Captures traces, screenshots, videos, HTML reports, and JSON results on failure.
- Supports unauthenticated and authenticated workflows.

## Install

From this folder:

```bash
npm install
npm run install:browsers
cp .env.example .env
```

Then edit `.env`:

```bash
APP_BASE_URL=http://localhost:3000
TEST_USER_EMAIL=your-test-user@example.com
TEST_USER_PASSWORD=your-test-password
```

Use a test-only account. Do not use production admin credentials.

## Run

Start your app first, then run:

```bash
npm test
```

For a visible browser:

```bash
npm run test:headed
```

To debug step by step:

```bash
npm run test:debug
```

To view the HTML report:

```bash
npm run report
```

## Add real workflows

Copy `workflows.example.json` to `workflows.json`:

```bash
cp workflows.example.json workflows.json
```

Then run with:

```bash
WORKFLOWS_FILE=./workflows.json npm test
```

Each workflow has this structure:

```json
{
  "name": "Create shipment",
  "requiresAuth": true,
  "steps": [
    { "action": "login" },
    { "action": "goto", "path": "/shipments/new" },
    { "action": "fill", "selector": "input[name='reference']", "value": "QA-TEST-001" },
    { "action": "click", "selector": "button[type='submit']" },
    { "action": "expectText", "selector": "body", "contains": "created" }
  ]
}
```

Supported actions:

- `goto`
- `click`
- `fill`
- `expectVisible`
- `expectVisibleAny`
- `expectText`
- `expectTitleOrUrl`
- `login`

## Recommended core LogisticsPro workflows

Start with these workflows:

1. Public landing page loads.
2. Login page loads.
3. User can log in with a test account.
4. Dashboard loads after login.
5. Create a customer/client.
6. Create a shipment or load.
7. Edit a shipment or load.
8. Search/filter shipments.
9. Assign driver/carrier/vehicle if applicable.
10. Upload or attach a document if applicable.
11. Generate invoice/proof-of-delivery if applicable.
12. Log out.

## CI usage

You can run this from GitHub Actions after the app is deployable in preview/staging. The best pattern is:

1. Deploy preview environment.
2. Set `APP_BASE_URL` to the preview URL.
3. Run `npm --prefix qa-agent test`.
4. Upload Playwright reports as CI artifacts.

## Safety

Use a dedicated QA/staging database and test users. Workflow tests create and edit records, so they should not run against production unless the workflows are explicitly read-only.
