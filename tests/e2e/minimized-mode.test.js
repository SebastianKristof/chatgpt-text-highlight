import { test, expect } from '@playwright/test';
import { loadMockConversation, openMockConversation, setupExtension } from './setup.js';

test.describe('E2E Minimized FAB Mode', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    context = await setupExtension();
    page = await openMockConversation(context, { conversationId: 'minimized-mode' });
  });

  test.afterEach(async () => {
    if (page && !page.isClosed()) {
      await page.close();
    }
    if (context) {
      await context.close();
    }
  });

  test('toggles and persists minimized mode across reload', async () => {
    await expect(page.locator('.ce-fab')).not.toHaveClass(/ce-fab-minimized/);

    await page.locator('.ce-fab-chevron').click();
    await expect(page.locator('.ce-fab')).toHaveClass(/ce-fab-minimized/);
    await expect(page.locator('.ce-fab-text')).toHaveCount(0);

    await loadMockConversation(page, { conversationId: 'minimized-mode' });
    await expect(page.locator('.ce-fab')).toHaveClass(/ce-fab-minimized/);

    await page.locator('.ce-fab-chevron').click();
    await expect(page.locator('.ce-fab')).not.toHaveClass(/ce-fab-minimized/);
    await expect(page.locator('.ce-fab-text')).toHaveText('Collected');
  });
});
