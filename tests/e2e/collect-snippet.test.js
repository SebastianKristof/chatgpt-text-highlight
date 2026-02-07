import { test, expect } from '@playwright/test';
import {
  collectCurrentSelection,
  openMockConversation,
  openPanel,
  selectMessageText,
  setupExtension,
} from './setup.js';

test.describe('E2E Collect Flow', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    context = await setupExtension();
    page = await openMockConversation(context, {
      conversationId: 'collect-flow',
      messages: [
        { id: 'msg-1', role: 'assistant', text: 'Alpha snippet for collection test.' },
        { id: 'msg-2', role: 'user', text: 'User asks for clarification.' },
      ],
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

  test('collects selected text and shows snippet in panel', async () => {
    await selectMessageText(page, 'msg-1');
    await collectCurrentSelection(page);

    await expect(page.locator('.ce-fab-count')).toHaveText('1');

    await openPanel(page);

    const items = page.locator('.ce-snippet-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Alpha snippet for collection test.');
  });
});
