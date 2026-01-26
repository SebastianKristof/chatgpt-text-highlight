import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { findMessageById, findMessageByTextHash, findMessageByPrefix, navigateToSource } from '../src/content/navigation.js';
import { hashText } from '../src/shared/hash.js';

// Setup DOM environment
beforeEach(() => {
  document.body.innerHTML = '';
  // Mock scrollIntoView for jsdom
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findMessageById', () => {
  it('finds message by data-message-id attribute', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    message.textContent = 'Test message';
    document.body.appendChild(message);

    const found = findMessageById('msg-123');
    expect(found).toBe(message);
  });

  it('returns null if message not found', () => {
    const found = findMessageById('non-existent');
    expect(found).toBeNull();
  });

  it('returns null for null or empty input', () => {
    expect(findMessageById(null)).toBeNull();
    expect(findMessageById('')).toBeNull();
  });

  it('finds message among multiple messages', () => {
    const msg1 = document.createElement('div');
    msg1.setAttribute('data-message-id', 'msg-1');
    msg1.textContent = 'First message';
    
    const msg2 = document.createElement('div');
    msg2.setAttribute('data-message-id', 'msg-2');
    msg2.textContent = 'Second message';
    
    document.body.appendChild(msg1);
    document.body.appendChild(msg2);

    const found = findMessageById('msg-2');
    expect(found).toBe(msg2);
  });
});

describe('findMessageByTextHash', () => {
  it('finds message by text hash', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'Hello world';
    document.body.appendChild(message);

    const textHash = hashText('Hello world');
    const found = findMessageByTextHash(textHash);
    expect(found).toBe(message);
  });

  it('handles whitespace normalization in hash matching', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'Hello   world\n  test';
    document.body.appendChild(message);

    const textHash = hashText('Hello world test');
    const found = findMessageByTextHash(textHash);
    expect(found).toBe(message);
  });

  it('returns null if message not found', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'Different text';
    document.body.appendChild(message);

    const textHash = hashText('Hello world');
    const found = findMessageByTextHash(textHash);
    expect(found).toBeNull();
  });

  it('returns null for null or empty input', () => {
    expect(findMessageByTextHash(null)).toBeNull();
    expect(findMessageByTextHash('')).toBeNull();
  });

  it('finds message by data-message-author-role attribute', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-author-role', 'assistant');
    message.textContent = 'Assistant message';
    document.body.appendChild(message);

    const textHash = hashText('Assistant message');
    const found = findMessageByTextHash(textHash);
    expect(found).toBe(message);
  });
});

describe('findMessageByPrefix', () => {
  it('finds message containing selection prefix', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'This is a long message with some text';
    document.body.appendChild(message);

    const found = findMessageByPrefix('long message');
    expect(found).toBe(message);
  });

  it('handles case-insensitive matching', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'Hello World';
    document.body.appendChild(message);

    const found = findMessageByPrefix('HELLO');
    expect(found).toBe(message);
  });

  it('trims prefix before matching', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'Hello world';
    document.body.appendChild(message);

    const found = findMessageByPrefix('  hello  ');
    expect(found).toBe(message);
  });

  it('returns null if prefix not found', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-1');
    message.textContent = 'Different text';
    document.body.appendChild(message);

    const found = findMessageByPrefix('nonexistent');
    expect(found).toBeNull();
  });

  it('returns null for null or empty input', () => {
    expect(findMessageByPrefix(null)).toBeNull();
    expect(findMessageByPrefix('')).toBeNull();
  });
});

describe('navigateToSource', () => {
  beforeEach(() => {
    // Mock window.location.href
    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://chatgpt.com/c/conv-123'
      },
      writable: true
    });
  });

  it('returns error if snippet has no anchor', () => {
    const snippet = { id: 'snippet-1', text: 'Test' };
    const result = navigateToSource(snippet);
    
    expect(result.success).toBe(false);
    expect(result.reason).toContain('no anchor');
  });

  it('finds message by messageId and highlights', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    message.textContent = 'This is a test message with some content';
    document.body.appendChild(message);

    const snippet = {
      id: 'snippet-1',
      text: 'test message',
      anchor: {
        conversationId: 'conv-123',
        messageId: 'msg-123',
        selectionOffsets: { start: 10, end: 22 }
      }
    };

    const result = navigateToSource(snippet);
    expect(result.success).toBe(true);
  });

  it('falls back to textHash if messageId not found', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-other');
    message.textContent = 'This is a test message';
    document.body.appendChild(message);

    const snippet = {
      id: 'snippet-1',
      text: 'test message',
      anchor: {
        conversationId: 'conv-123',
        messageId: 'msg-123',
        textHash: hashText('This is a test message'),
        selectionOffsets: { start: 10, end: 22 }
      }
    };

    const result = navigateToSource(snippet);
    expect(result.success).toBe(true);
  });

  it('falls back to selectionPrefix if textHash not found', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-other');
    message.textContent = 'This is a test message with content';
    document.body.appendChild(message);

    const snippet = {
      id: 'snippet-1',
      text: 'test message',
      anchor: {
        conversationId: 'conv-123',
        messageId: 'msg-123',
        textHash: 'wrong-hash',
        selectionPrefix: 'test message',
        selectionOffsets: { start: 10, end: 22 }
      }
    };

    const result = navigateToSource(snippet);
    expect(result.success).toBe(true);
  });

  it('returns error if message not found in current conversation', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'test',
      anchor: {
        conversationId: 'conv-123',
        messageId: 'msg-123'
      }
    };

    const result = navigateToSource(snippet);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('returns error if conversation ID mismatch', () => {
    window.location.href = 'https://chatgpt.com/c/conv-456';

    const snippet = {
      id: 'snippet-1',
      text: 'test',
      anchor: {
        conversationId: 'conv-123',
        messageId: 'msg-123'
      }
    };

    const result = navigateToSource(snippet);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('different conversation');
  });

  it('highlights whole message if no selection offsets', () => {
    const message = document.createElement('div');
    message.setAttribute('data-message-id', 'msg-123');
    message.textContent = 'Test message';
    document.body.appendChild(message);

    const snippet = {
      id: 'snippet-1',
      text: 'test',
      anchor: {
        conversationId: 'conv-123',
        messageId: 'msg-123'
      }
    };

    const result = navigateToSource(snippet);
    expect(result.success).toBe(true);
    // Message should have highlight class (will be removed after timeout)
  });
});
