import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupExtension() {
  const extensionPath = path.join(__dirname, '..', '..');
  
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  
  return context;
}

export async function getExtensionId(context) {
  // Try to get extension ID from service worker
  try {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 5000 });
    }
    
    if (background) {
      const extensionId = background.url().split('/')[2];
      return extensionId;
    }
  } catch (e) {
    // Extension might not have a service worker
  }
  
  // Fallback: try to get from chrome://extensions page
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  await page.waitForTimeout(1000);
  
  // This is a fallback - in practice, extension ID might not be easily accessible
  // For testing, we can work without it
  await page.close();
  return null;
}

export async function mockChatGPTPage(page) {
  // Mock a basic ChatGPT-like page structure
  await page.evaluate(() => {
    document.body.innerHTML = `
      <header>ChatGPT Header</header>
      <main>
        <div data-message-id="msg-1" data-message-author-role="assistant">
          <p>This is a test message from ChatGPT. It contains some text that can be selected and saved as a snippet.</p>
        </div>
        <div data-message-id="msg-2" data-message-author-role="user">
          <p>This is a user message.</p>
        </div>
        <div data-message-id="msg-3" data-message-author-role="assistant">
          <p>Another assistant message with more content to select.</p>
        </div>
      </main>
    `;
  });
  
  // Wait a bit for extension to inject
  await page.waitForTimeout(500);
}
