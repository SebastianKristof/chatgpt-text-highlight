import { test, expect } from '@playwright/test';
import { setupExtension, mockChatGPTPage } from './setup.js';

test.describe('Minimized Mode', () => {
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
    await page.goto('https://chatgpt.com/');
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000); // Wait for extension to load
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should show full FAB by default', async () => {
    const fab = page.locator('.ce-fab');
    await expect(fab).toBeVisible();
    
    const fabText = page.locator('.ce-fab-text');
    await expect(fabText).toBeVisible();
    await expect(fabText).toHaveText('Collected');
    
    // Should have chevron pointing right (›)
    const chevron = page.locator('.ce-fab-chevron');
    await expect(chevron).toBeVisible();
    await expect(chevron).toHaveText('›');
  });

  test('should minimize when clicking chevron', async () => {
    const chevron = page.locator('.ce-fab-chevron');
    await chevron.click();
    await page.waitForTimeout(300); // Wait for re-render
    
    const fab = page.locator('.ce-fab');
    await expect(fab).toHaveClass(/ce-fab-minimized/);
    
    // Text should be hidden
    const fabText = page.locator('.ce-fab-text');
    await expect(fabText).not.toBeVisible();
    
    // Chevron should point left (‹)
    const newChevron = page.locator('.ce-fab-chevron');
    await expect(newChevron).toHaveText('‹');
  });

  test('should maximize when clicking chevron in minimized mode', async () => {
    // First minimize
    await page.locator('.ce-fab-chevron').click();
    await page.waitForTimeout(300);
    
    // Then maximize
    await page.locator('.ce-fab-chevron').click();
    await page.waitForTimeout(300);
    
    const fab = page.locator('.ce-fab');
    await expect(fab).not.toHaveClass(/ce-fab-minimized/);
    
    const fabText = page.locator('.ce-fab-text');
    await expect(fabText).toBeVisible();
  });

  test('should persist minimized state', async () => {
    // Minimize
    await page.locator('.ce-fab-chevron').click();
    await page.waitForTimeout(300);
    
    // Reload page
    await page.reload();
    await mockChatGPTPage(page);
    await page.waitForTimeout(1000);
    
    // Should still be minimized
    const fab = page.locator('.ce-fab');
    await expect(fab).toHaveClass(/ce-fab-minimized/);
  });

  test('should open panel when clicking FAB body (not chevron)', async () => {
    const fabCount = page.locator('.ce-fab-count');
    await fabCount.click();
    
    const panel = page.locator('.ce-panel');
    await expect(panel).toHaveClass(/ce-panel-open/);
  });

  test('should show minimized toolbar when selecting text in minimized mode', async () => {
    // Minimize FAB
    await page.locator('.ce-fab-chevron').click();
    await page.waitForTimeout(300);
    
    // Select text
    await page.evaluate(() => {
      const messageEl = document.querySelector('[data-message-id="msg-1"]');
      const range = document.createRange();
      range.selectNodeContents(messageEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    
    // Trigger mouseup to show toolbar
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    const toolbar = page.locator('.ce-selection-toolbar');
    await expect(toolbar).toHaveClass(/ce-toolbar-minimized/);
    
    // Labels should be hidden, only icons visible
    const labels = page.locator('.ce-toolbar-label');
    await expect(labels.first()).not.toBeVisible();
  });

  test('should not trigger drag when clicking chevron', async () => {
    const fabInitialPosition = await page.locator('.ce-fab').boundingBox();
    
    // Click chevron
    await page.locator('.ce-fab-chevron').click();
    await page.waitForTimeout(500);
    
    const fabNewPosition = await page.locator('.ce-fab').boundingBox();
    
    // Position should be roughly the same (allowing for small size changes)
    expect(Math.abs(fabInitialPosition.y - fabNewPosition.y)).toBeLessThan(50);
  });
});
