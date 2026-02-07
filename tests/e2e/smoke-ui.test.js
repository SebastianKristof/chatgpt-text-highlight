import { test, expect } from '@playwright/test';
import { openMockConversation, setupExtension } from './setup.js';

test.describe('E2E Smoke UI', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    context = await setupExtension();
    page = await openMockConversation(context, { conversationId: 'smoke-ui' });
  });

  test.afterEach(async () => {
    if (page && !page.isClosed()) {
      await page.close();
    }
    if (context) {
      await context.close();
    }
  });

  test('renders FAB and toggles panel', async () => {
    const fab = page.locator('.ce-fab');
    await expect(fab).toBeVisible();
    await expect(page.locator('.ce-fab-text')).toHaveText('Collected');
    await expect(page.locator('.ce-fab-count')).toHaveText('0');

    await page.locator('.ce-fab-text').click();

    const panel = page.locator('.ce-panel');
    await expect(panel).toHaveClass(/ce-panel-open/);
    await expect(panel.locator('.ce-panel-title')).toHaveText('Collected Snippets');

    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(panel).not.toHaveClass(/ce-panel-open/);
  });
});
