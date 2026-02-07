import { test, expect } from '@playwright/test';
import {
  collectSnippetFromMessage,
  openMockConversation,
  openPanel,
  setupExtension,
} from './setup.js';

test.describe('E2E Panel Actions', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    context = await setupExtension();
    page = await openMockConversation(context, {
      conversationId: 'panel-actions',
      messages: [
        { id: 'msg-1', role: 'assistant', text: 'First snippet candidate.' },
        { id: 'msg-2', role: 'assistant', text: 'Second snippet candidate.' },
        { id: 'msg-3', role: 'assistant', text: 'Third snippet candidate.' },
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

  test('clears selected snippets through panel action bar', async () => {
    await collectSnippetFromMessage(page, 'msg-1');
    await collectSnippetFromMessage(page, 'msg-3');

    await openPanel(page);
    await expect(page.locator('.ce-snippet-item')).toHaveCount(2);

    const selectAll = page.locator('.ce-select-all-checkbox');
    await expect(selectAll).toBeEnabled();
    await selectAll.check();

    const clearSelected = page.locator('.ce-btn-clear-selected');
    await expect(clearSelected).toBeEnabled();
    await clearSelected.click();

    const modal = page.locator('.ce-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.ce-modal-title')).toHaveText('Clear selected snippets?');
    await modal.getByRole('button', { name: 'Clear' }).click();

    await expect(page.locator('.ce-snippet-item')).toHaveCount(0);
    await expect(page.locator('.ce-btn-clear-selected')).toBeDisabled();
  });
});
