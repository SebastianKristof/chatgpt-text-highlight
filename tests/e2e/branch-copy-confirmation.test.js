import { test, expect } from '@playwright/test';
import { setupExtension, mockChatGPTPage } from './setup.js';

test.describe('Branch Copy Confirmation', () => {
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

  test('should show confirmation modal when branching with snippets', async () => {
    // Create snippet in parent conversation
    await page.goto('https://chatgpt.com/c/parent-conversation');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
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
    
    // Navigate to child conversation (simulating branch)
    await page.goto('https://chatgpt.com/c/child-conversation');
    await page.evaluate(() => {
      document.body.innerHTML = `
        <header>ChatGPT Header</header>
        <main>
          <div class="mx-auto mt-8 flex w-full items-center justify-center">
            <p class="text-xs">
              <a target="_self" href="/c/parent-conversation">Branched from parent</a>
            </p>
          </div>
          <div data-message-id="msg-1" data-message-author-role="assistant">
            <p>New conversation message</p>
          </div>
        </main>
      `;
    });
    
    await page.waitForTimeout(7000); // Wait for branch detection
    
    // Should show confirmation modal
    const modal = page.locator('.ce-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    
    await expect(modal).toContainText('Copy snippets from parent thread?');
  });

  test('should have "Don\'t ask again" checkbox', async () => {
    // Setup: create snippet and navigate to branched conversation
    await page.goto('https://chatgpt.com/c/parent-conversation-2');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
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
    
    await page.goto('https://chatgpt.com/c/child-conversation-2');
    await page.evaluate(() => {
      document.body.innerHTML = `
        <header>ChatGPT Header</header>
        <main>
          <div class="mx-auto mt-8 flex w-full items-center justify-center">
            <p class="text-xs">
              <a target="_self" href="/c/parent-conversation-2">Branched from parent</a>
            </p>
          </div>
          <div data-message-id="msg-1" data-message-author-role="assistant">
            <p>New message</p>
          </div>
        </main>
      `;
    });
    
    await page.waitForTimeout(7000);
    
    const modal = page.locator('.ce-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    
    // Check for checkbox
    const checkbox = page.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    
    const checkboxLabel = page.locator('text="Don\'t ask again"');
    await expect(checkboxLabel).toBeVisible();
  });

  test('should copy snippets when confirmed', async () => {
    // Setup
    await page.goto('https://chatgpt.com/c/parent-conversation-3');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
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
    
    await page.goto('https://chatgpt.com/c/child-conversation-3');
    await page.evaluate(() => {
      document.body.innerHTML = `
        <header>ChatGPT Header</header>
        <main>
          <div class="mx-auto mt-8 flex w-full items-center justify-center">
            <p class="text-xs">
              <a target="_self" href="/c/parent-conversation-3">Branched from parent</a>
            </p>
          </div>
          <div data-message-id="msg-1" data-message-author-role="assistant">
            <p>New message</p>
          </div>
        </main>
      `;
    });
    
    await page.waitForTimeout(7000);
    
    const modal = page.locator('.ce-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    
    // Click Copy button
    const copyBtn = page.locator('button:has-text("Copy")');
    await copyBtn.click();
    await page.waitForTimeout(1000);
    
    // Open panel to verify snippet was copied
    await page.locator('.ce-fab-count').click();
    await page.waitForTimeout(500);
    
    const snippets = page.locator('.ce-snippet-item');
    await expect(snippets).toHaveCount(1);
  });

  test('should not copy when cancelled', async () => {
    // Setup
    await page.goto('https://chatgpt.com/c/parent-conversation-4');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
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
    
    await page.goto('https://chatgpt.com/c/child-conversation-4');
    await page.evaluate(() => {
      document.body.innerHTML = `
        <header>ChatGPT Header</header>
        <main>
          <div class="mx-auto mt-8 flex w-full items-center justify-center">
            <p class="text-xs">
              <a target="_self" href="/c/parent-conversation-4">Branched from parent</a>
            </p>
          </div>
          <div data-message-id="msg-1" data-message-author-role="assistant">
            <p>New message</p>
          </div>
        </main>
      `;
    });
    
    await page.waitForTimeout(7000);
    
    const modal = page.locator('.ce-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    
    // Click Cancel button
    const cancelBtn = page.locator('button:has-text("Cancel")');
    await cancelBtn.click();
    await page.waitForTimeout(500);
    
    // Open panel to verify no snippet in child conversation
    await page.locator('.ce-fab-count').click();
    await page.waitForTimeout(500);
    
    const emptyState = page.locator('.ce-empty-state');
    await expect(emptyState).toBeVisible();
  });
});
