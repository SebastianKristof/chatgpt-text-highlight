import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.join(__dirname, '..', '..');
const playwrightCacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
const mockRouteHandlers = new WeakMap();

function resolveBrowserCandidates() {
  return [
    process.env.E2E_BROWSER_PATH,
    path.join(playwrightCacheDir, 'chromium-1208', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join(playwrightCacheDir, 'chromium-1208', 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter(Boolean);
}

function resolveExecutablePath() {
  const candidates = resolveBrowserCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function setupExtension() {
  const executablePath = resolveExecutablePath();
  const e2eHomeDir = path.join(os.tmpdir(), 'ce-e2e-home');
  mkdirSync(e2eHomeDir, { recursive: true });
  const launchOptions = {
    headless: false,
    env: {
      ...process.env,
      HOME: e2eHomeDir,
    },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  try {
    return await chromium.launchPersistentContext('', launchOptions);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("Executable doesn't exist")) {
      const candidates = resolveBrowserCandidates().map((item) => `- ${item}`).join('\n');
      throw new Error(
        `Cannot launch browser for E2E tests.\n` +
          `Install Playwright Chromium (npx playwright install chromium) or set E2E_BROWSER_PATH.\n` +
          `Checked paths:\n${candidates}\n\n` +
          `Original error: ${message}`
      );
    }
    throw error;
  }
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

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildMockMarkup(messages) {
  const messageBlocks = messages
    .map((message) => {
      const role = message.role || 'assistant';
      const id = message.id || 'msg';
      const text = escapeHtml(message.text || '');
      return `<div data-message-id="${escapeHtml(id)}" data-message-author-role="${escapeHtml(role)}"><p>${text}</p></div>`;
    })
    .join('');

  return `
    <header>ChatGPT Header</header>
    <main>
      ${messageBlocks}
    </main>
  `;
}

export async function waitForExtensionReady(page) {
  await expect(page.locator('.ce-fab')).toBeVisible({ timeout: 10_000 });
}

export async function loadMockConversation(page, options = {}) {
  const {
    conversationId = 'e2e-thread',
    messages = [
      { id: 'msg-1', role: 'assistant', text: 'Alpha snippet from assistant.' },
      { id: 'msg-2', role: 'user', text: 'User asks a follow-up question.' },
      { id: 'msg-3', role: 'assistant', text: 'Beta snippet from assistant.' },
    ],
  } = options;

  const url = `https://chatgpt.com/c/${conversationId}`;
  const markup = buildMockMarkup(messages);
  const htmlDocument = `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT E2E Mock</title></head><body><div id="ce-e2e-host">${markup}</div></body></html>`;

  const existingHandler = mockRouteHandlers.get(page);
  if (existingHandler) {
    await page.unroute('https://chatgpt.com/**', existingHandler);
  }

  const handler = async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: htmlDocument,
      });
      return;
    }

    await route.fulfill({
      status: 204,
      contentType: 'text/plain; charset=utf-8',
      body: '',
    });
  };
  mockRouteHandlers.set(page, handler);
  await page.route('https://chatgpt.com/**', handler);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await waitForExtensionReady(page);
}

export async function openMockConversation(context, options = {}) {
  const page = await context.newPage();
  await loadMockConversation(page, options);
  return page;
}

export async function selectMessageText(page, messageId = 'msg-1') {
  await page.evaluate((id) => {
    const messageEl = document.querySelector(`[data-message-id="${id}"]`);
    if (!messageEl) {
      throw new Error(`Message block not found: ${id}`);
    }
    const range = document.createRange();
    range.selectNodeContents(messageEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, messageId);

  await page.mouse.up();
  const toolbar = page.locator('.ce-selection-toolbar:visible').last();
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  await expect(toolbar.getByRole('button', { name: 'Collect snippet' }).first()).toBeVisible();
}

export async function collectCurrentSelection(page) {
  const collectBtn = page.locator('.ce-selection-toolbar .ce-toolbar-btn', { hasText: 'Collect' }).last();
  await expect(collectBtn).toBeVisible();
  await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && !!el.getClientRects().length;
    };

    const buttons = Array.from(document.querySelectorAll('.ce-selection-toolbar .ce-toolbar-btn'))
      .filter((el) => el.textContent?.includes('Collect') && isVisible(el));

    const target = buttons[buttons.length - 1];
    if (!target) {
      throw new Error('Visible Collect button not found');
    }
    target.click();
  });
}

export async function collectSnippetFromMessage(page, messageId = 'msg-1') {
  await selectMessageText(page, messageId);
  await collectCurrentSelection(page);
}

export async function openPanel(page) {
  const fabText = page.locator('.ce-fab-text').first();
  if (await fabText.count()) {
    await fabText.click();
  } else {
    await page.locator('.ce-fab').click();
  }
  await expect(page.locator('.ce-panel')).toHaveClass(/ce-panel-open/);
}
