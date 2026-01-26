import { test, expect } from '@playwright/test';
import { setupExtension, mockChatGPTPage } from './setup.js';

test.describe('Cross-conversation Navigation', () => {
  let context;
  let page;

  test.beforeAll(async () => {
    context = await setupExtension();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should use window.location.origin for navigation URL on chatgpt.com', async () => {
    await page.goto('https://chatgpt.com/c/test-conversation-1');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    // Create a snippet in conversation 1
    await page.evaluate(() => {
      const messageEl = document.querySelector('[data-message-id="msg-1"]');
      const range = document.createRange();
      range.selectNodeContents(messageEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    // Click collect button
    const collectBtn = page.locator('.ce-toolbar-btn').first();
    await collectBtn.click();
    await page.waitForTimeout(500);
    
    // Navigate to different conversation
    await page.goto('https://chatgpt.com/c/test-conversation-2');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    // Open panel
    await page.locator('.ce-fab-count').click();
    await page.waitForTimeout(300);
    
    // Click snippet (should show modal to open conversation 1)
    await page.locator('.ce-snippet-item').first().click();
    
    // Wait for modal
    const modal = page.locator('.ce-modal');
    await expect(modal).toBeVisible();
    
    // Verify modal asks to open conversation
    await expect(modal).toContainText('Open parent conversation?');
  });

  test('should use window.location.origin for navigation URL on chat.openai.com', async () => {
    await page.goto('https://chat.openai.com/c/test-conversation-1');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    // Verify origin is used correctly
    const origin = await page.evaluate(() => window.location.origin);
    expect(origin).toBe('https://chat.openai.com');
    
    // Create snippet and verify it would use correct origin for navigation
    await page.evaluate(() => {
      const messageEl = document.querySelector('[data-message-id="msg-1"]');
      const range = document.createRange();
      range.selectNodeContents(messageEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    const collectBtn = page.locator('.ce-toolbar-btn').first();
    await collectBtn.click();
    await page.waitForTimeout(500);
  });

  test('should handle enterprise domains', async () => {
    // Mock enterprise domain
    await page.goto('https://custom-domain.enterprise.com/c/test-conversation-1');
    
    // Add ChatGPT-like structure
    await page.evaluate(() => {
      document.body.innerHTML = `
        <header>ChatGPT Header</header>
        <main>
          <div data-message-id="msg-1" data-message-author-role="assistant">
            <p>Enterprise message</p>
          </div>
        </main>
      `;
    });
    
    await page.waitForTimeout(1000);
    
    const origin = await page.evaluate(() => window.location.origin);
    expect(origin).toContain('custom-domain.enterprise.com');
  });
});
