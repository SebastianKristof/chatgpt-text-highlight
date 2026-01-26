# E2E Tests

End-to-end tests for the ChatGPT Text Highlight extension using Playwright.

## Setup

Install dependencies:

```bash
npm install
```

Install Playwright browsers:

```bash
npx playwright install chromium
```

## Running Tests

Run all e2e tests:

```bash
npm run test:e2e
```

Run tests in UI mode (interactive):

```bash
npm run test:e2e:ui
```

Run tests in debug mode:

```bash
npm run test:e2e:debug
```

Run a specific test file:

```bash
npx playwright test tests/e2e/minimized-mode.test.js
```

## Test Structure

- `setup.js` - Shared utilities for setting up extension context and mocking ChatGPT pages
- `minimized-mode.test.js` - Tests for FAB minimized mode functionality
- `cross-conversation-navigation.test.js` - Tests for cross-conversation URL handling
- `toast-behavior.test.js` - Tests for toast notification behavior (show once per session)
- `branch-copy-confirmation.test.js` - Tests for branch copy confirmation modal

## Test Coverage

### Minimized Mode
- ✅ FAB shows in full mode by default
- ✅ Clicking chevron minimizes FAB
- ✅ Clicking chevron in minimized mode expands FAB
- ✅ Minimized state persists across page reloads
- ✅ Panel opens when clicking FAB body (not chevron)
- ✅ Toolbar shows minimized when FAB is minimized
- ✅ No drag issues when clicking chevron

### Cross-Conversation Navigation
- ✅ Uses `window.location.origin` for navigation URLs
- ✅ Works on chatgpt.com
- ✅ Works on chat.openai.com
- ✅ Works on enterprise domains

### Toast Behavior
- ✅ "Loaded X snippets" shows only once per session
- ✅ SessionStorage flag is set correctly
- ✅ New sessions show toast again

### Branch Copy Confirmation
- ✅ Shows confirmation modal when branching
- ✅ Has "Don't ask again" checkbox
- ✅ Copies snippets when confirmed
- ✅ Doesn't copy when cancelled

## Notes

- Tests run in non-headless mode to support Chrome extension testing
- Extension is loaded automatically via Playwright's extension loading
- Some tests may require longer timeouts due to extension initialization
- Tests mock ChatGPT page structure rather than using real ChatGPT (to avoid rate limits)
