# E2E Tests (Baseline)

This folder contains a fresh baseline E2E suite for the active extension runtime.

## Goals

- Cover core user-critical behavior with stable smoke tests.
- Keep test setup deterministic (mocked page content, no network dependence).
- Make failures actionable instead of flaky.

## Current Coverage

- `smoke-ui.test.js`: extension UI renders, FAB works, panel open/close works.
- `collect-snippet.test.js`: text selection -> Collect -> snippet appears in panel.
- `search-scope.test.js`: search scope toggle (`Thread` -> `All`) and cross-thread search.
- `minimized-mode.test.js`: FAB minimize/expand behavior and persistence after reload.
- `panel-actions.test.js`: bulk select + clear selected flow through compact action bar.

## Browser Resolution

`setup.js` resolves a Chromium executable in this order:

1. `E2E_BROWSER_PATH` env var (if set)
2. Google Chrome app
3. Brave Browser app
4. Playwright Chromium cache

This avoids brittle behavior when Playwright browser cache is stale or arch-mismatched.

## Network Isolation

`setup.js` intercepts `https://chatgpt.com/**` requests and fulfills them with local HTML fixtures.
That means tests do not hit real ChatGPT and do not get blocked by Cloudflare challenges.

## Running

```bash
npm run test:e2e
```

Single file:

```bash
npx playwright test tests/e2e/smoke-ui.test.js
```

If browser launch fails, either:

```bash
npx playwright install chromium
```

or set:

```bash
E2E_BROWSER_PATH="/path/to/chromium-based-browser"
```
