import { test, expect } from '@playwright/test';
import {
  collectCurrentSelection,
  loadMockConversation,
  openMockConversation,
  openPanel,
  selectMessageText,
  setupExtension,
} from './setup.js';

test.describe('E2E Search Scope', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    context = await setupExtension();
    page = await openMockConversation(context, {
      conversationId: 'thread-a',
      messages: [{ id: 'msg-1', role: 'assistant', text: 'Alpha unique snippet.' }],
    });
  });

  test.afterEach(async () => {
    if (page && !page.isClosed()) {
      await page.close();
    }
    if (context) {
      await context.close();
    }
  });

  test('switches scope from thread to all for search', async () => {
    await selectMessageText(page, 'msg-1');
    await collectCurrentSelection(page);
    await expect(page.locator('.ce-fab-count')).toHaveText('1');

    await loadMockConversation(page, {
      conversationId: 'thread-b',
      messages: [{ id: 'msg-1', role: 'assistant', text: 'Beta unique snippet.' }],
    });
    await selectMessageText(page, 'msg-1');
    await collectCurrentSelection(page);
    await expect(page.locator('.ce-fab-count')).toHaveText('1');

    await openPanel(page);
    await page.locator('.ce-search-input').fill('unique snippet');

    const scopeToggle = page.locator('.ce-scope-toggle');
    await expect(scopeToggle).toBeVisible();
    await expect(scopeToggle).toHaveText('Thread');

    await expect(page.locator('.ce-snippet-item')).toHaveCount(1);

    await scopeToggle.click();
    await expect(scopeToggle).toHaveText('All');
    await expect(page.locator('.ce-snippet-item')).toHaveCount(2);
  });
});
