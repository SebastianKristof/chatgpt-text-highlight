import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getConversationId,
  findMessageBlock,
  getMessageId,
  getMessageText,
  isSelectionInExtensionUI,
  getSelectionText,
  buildSnippetFromSelection
} from '../src/content/selection.js';
import { getConversationIdFromUrl, getProjectIdFromUrl } from '../src/shared/urlIds.js';

// Mock URL functions
vi.mock('../src/shared/urlIds.js', () => ({
  getConversationIdFromUrl: vi.fn(),
  getProjectIdFromUrl: vi.fn()
}));

describe('getConversationId', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { href: 'https://chatgpt.com/c/conv-123' },
      writable: true
    });
  });

  it('returns conversation ID from current URL', () => {
    getConversationIdFromUrl.mockReturnValue('conv-123');
    
    const id = getConversationId();
    expect(id).toBe('conv-123');
    expect(getConversationIdFromUrl).toHaveBeenCalledWith('https://chatgpt.com/c/conv-123');
  });

  it('returns null when no conversation ID in URL', () => {
    getConversationIdFromUrl.mockReturnValue(null);
    
    const id = getConversationId();
    expect(id).toBeNull();
  });
});

describe('findMessageBlock', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds message block by data-message-id', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    const child = document.createElement('p');
    child.textContent = 'Test';
    message.appendChild(child);
    document.body.appendChild(message);

    const found = findMessageBlock(child);
    expect(found).toBe(message);
  });

  it('finds message block by data-message-author-role', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-author-role', 'assistant');
    const child = document.createElement('p');
    child.textContent = 'Test';
    message.appendChild(child);
    document.body.appendChild(message);

    const found = findMessageBlock(child);
    expect(found).toBe(message);
  });

  it('finds message block by class name containing "message"', () => {
    const message = document.createElement('div');
    message.className = 'message-group';
    const child = document.createElement('p');
    child.textContent = 'Test';
    message.appendChild(child);
    document.body.appendChild(message);

    const found = findMessageBlock(child);
    expect(found).toBe(message);
  });

  it('returns null if no message block found', () => {
    const div = document.createElement('div');
    const child = document.createElement('p');
    child.textContent = 'Test';
    div.appendChild(child);
    document.body.appendChild(div);

    const found = findMessageBlock(child);
    expect(found).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findMessageBlock(null)).toBeNull();
  });

  it('handles element node directly', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    document.body.appendChild(message);

    const found = findMessageBlock(message);
    expect(found).toBe(message);
  });
});

describe('getMessageId', () => {
  it('extracts message ID from element', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');

    const id = getMessageId(message);
    expect(id).toBe('msg-123');
  });

  it('returns null if no message ID', () => {
    const message = document.createElement('div');
    const id = getMessageId(message);
    expect(id).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getMessageId(null)).toBeNull();
  });
});

describe('getMessageText', () => {
  it('extracts text content from message block', () => {
    const message = document.createElement('div');
    message.innerHTML = '<p>Hello <strong>world</strong></p>';
    
    const text = getMessageText(message);
    expect(text).toBe('Hello world');
  });

  it('trims whitespace', () => {
    const message = document.createElement('div');
    message.textContent = '  Hello world  ';
    
    const text = getMessageText(message);
    expect(text).toBe('Hello world');
  });

  it('returns empty string for empty message', () => {
    const message = document.createElement('div');
    const text = getMessageText(message);
    expect(text).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(getMessageText(null)).toBe('');
  });
});

describe('isSelectionInExtensionUI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false for empty selection', () => {
    const selection = {
      rangeCount: 0
    };
    expect(isSelectionInExtensionUI(selection)).toBe(false);
  });

  it('returns false for null selection', () => {
    expect(isSelectionInExtensionUI(null)).toBe(false);
  });

  it('returns true if selection is in extension container', () => {
    const container = document.createElement('div');
    container.id = 'ce-root';
    const child = document.createElement('p');
    child.textContent = 'Test';
    container.appendChild(child);
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(child);
    const selection = {
      rangeCount: 1,
      getRangeAt: () => range
    };

    expect(isSelectionInExtensionUI(selection)).toBe(true);
  });

  it('returns true if selection is in element with ce-extension class', () => {
    const container = document.createElement('div');
    container.className = 'ce-extension';
    const child = document.createElement('p');
    child.textContent = 'Test';
    container.appendChild(child);
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(child);
    const selection = {
      rangeCount: 1,
      getRangeAt: () => range
    };

    expect(isSelectionInExtensionUI(selection)).toBe(true);
  });

  it('returns false if selection is outside extension UI', () => {
    const div = document.createElement('div');
    const child = document.createElement('p');
    child.textContent = 'Test';
    div.appendChild(child);
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(child);
    const selection = {
      rangeCount: 1,
      getRangeAt: () => range
    };

    expect(isSelectionInExtensionUI(selection)).toBe(false);
  });
});

describe('getSelectionText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns selected text', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello world';
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const text = getSelectionText();
    expect(text).toBe('Hello world');
  });

  it('trims whitespace', () => {
    const div = document.createElement('div');
    div.textContent = '  Hello world  ';
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const text = getSelectionText();
    expect(text).toBe('Hello world');
  });

  it('returns empty string for collapsed selection', () => {
    const selection = window.getSelection();
    selection.removeAllRanges();
    
    const text = getSelectionText();
    expect(text).toBe('');
  });
});

describe('buildSnippetFromSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', {
      value: { href: 'https://chatgpt.com/c/conv-123' },
      writable: true
    });
    getConversationIdFromUrl.mockReturnValue('conv-123');
    getProjectIdFromUrl.mockReturnValue(null);
  });

  afterEach(() => {
    const selection = window.getSelection();
    selection.removeAllRanges();
  });

  it('returns null for collapsed selection', () => {
    const result = buildSnippetFromSelection();
    expect(result).toBeNull();
  });

  it('returns null for selection in extension UI', () => {
    const container = document.createElement('div');
    container.id = 'ce-root';
    container.textContent = 'Extension content';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const result = buildSnippetFromSelection();
    expect(result).toBeNull();
  });

  it('returns null for selection shorter than minimum length', () => {
    const div = document.createElement('div');
    div.textContent = 'ab';
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const result = buildSnippetFromSelection();
    expect(result).toBeNull();
  });

  it('creates snippet from valid selection', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    message.textContent = 'This is a test message with some content';
    document.body.appendChild(message);

    const range = document.createRange();
    range.selectNodeContents(message);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const result = buildSnippetFromSelection();
    expect(result).not.toBeNull();
    expect(result.text).toBe('This is a test message with some content');
    expect(result.conversationId).toBe('conv-123');
    expect(result.anchor).toBeDefined();
    expect(result.anchor.messageId).toBe('msg-123');
  });

  it('creates snippet without anchor if message block not found', () => {
    const div = document.createElement('div');
    div.textContent = 'Test content';
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const result = buildSnippetFromSelection();
    expect(result).not.toBeNull();
    expect(result.text).toBe('Test content');
    expect(result.anchor).toBeNull();
  });

  it('truncates text if longer than max size', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    const longText = 'a'.repeat(15000);
    message.textContent = longText;
    document.body.appendChild(message);

    const range = document.createRange();
    range.selectNodeContents(message);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const result = buildSnippetFromSelection();
    expect(result).not.toBeNull();
    expect(result.text.length).toBe(10000);
    expect(result.truncated).toBe(true);
  });

  it('includes projectId when available', () => {
    getProjectIdFromUrl.mockReturnValue('proj-123');
    
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    message.textContent = 'Test message';
    document.body.appendChild(message);

    const range = document.createRange();
    range.selectNodeContents(message);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const result = buildSnippetFromSelection();
    expect(result.projectId).toBe('proj-123');
  });
});
