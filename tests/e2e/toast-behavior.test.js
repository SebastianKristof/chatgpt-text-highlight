import { test, expect } from '@playwright/test';
import { setupExtension, mockChatGPTPage } from './setup.js';

test.describe('Toast Behavior', () => {
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
    await page.goto('https://chatgpt.com/c/test-conversation');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should show "Loaded X snippets" toast only once per session', async () => {
    // Create a snippet
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
    
    // Reload page - should show "Loaded" toast
    await page.reload();
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    const toast1 = page.locator('.ce-toast:has-text("Loaded")');
    await expect(toast1).toBeVisible();
    
    // Wait for toast to disappear
    await page.waitForTimeout(3500);
    
    // Reload again - should NOT show toast
    await page.reload();
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    const toast2 = page.locator('.ce-toast:has-text("Loaded")');
    await expect(toast2).not.toBeVisible();
  });

  test('should verify sessionStorage flag is set', async () => {
    // Create a snippet
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
    
    // Reload and wait for toast
    await page.reload();
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    // Check sessionStorage
    const flagSet = await page.evaluate(() => {
      return sessionStorage.getItem('ce_snippets_loaded_toast_shown') === 'true';
    });
    
    expect(flagSet).toBe(true);
  });

  test('should reset toast behavior in new tab/session', async () => {
    // Create snippet in first page
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
    
    // Reload to trigger toast and set flag
    await page.reload();
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    // Open new tab (new session context)
    const newPage = await context.newPage();
    await newPage.goto('https://chatgpt.com/c/test-conversation');
    await mockChatGPTPage(newPage);
    await newPage.waitForTimeout(1000);
    
    // Should show toast in new session
    const toast = newPage.locator('.ce-toast:has-text("Loaded")');
    await expect(toast).toBeVisible();
    
    await newPage.close();
  });
});
