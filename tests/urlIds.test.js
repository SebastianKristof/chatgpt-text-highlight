import { describe, it, expect } from 'vitest';
import { getConversationIdFromUrl, getProjectIdFromUrl, isProjectPage } from '../src/shared/urlIds.js';

describe('getConversationIdFromUrl', () => {
  it('extracts conversation ID from /c/{id} pattern', () => {
    expect(getConversationIdFromUrl('https://chatgpt.com/c/abc123')).toBe('abc123');
    expect(getConversationIdFromUrl('https://chatgpt.com/c/conv-456')).toBe('conv-456');
  });

  it('extracts conversation ID from query parameter', () => {
    expect(getConversationIdFromUrl('https://chatgpt.com/?conversationId=xyz789')).toBe('xyz789');
    expect(getConversationIdFromUrl('https://chatgpt.com/page?conversationId=test-123&other=value')).toBe('test-123');
  });

  it('prefers /c/{id} pattern over query parameter', () => {
    expect(getConversationIdFromUrl('https://chatgpt.com/c/from-path?conversationId=from-query')).toBe('from-path');
  });

  it('handles multiple /c/{id} patterns and uses the last one', () => {
    expect(getConversationIdFromUrl('https://chatgpt.com/g/proj123/c/conv1/c/conv2')).toBe('conv2');
  });

  it('handles URL-encoded conversation IDs', () => {
    expect(getConversationIdFromUrl('https://chatgpt.com/c/hello%20world')).toBe('hello world');
    expect(getConversationIdFromUrl('https://chatgpt.com/?conversationId=test%2F123')).toBe('test/123');
  });

  it('returns null for URLs without conversation ID', () => {
    expect(getConversationIdFromUrl('https://chatgpt.com/')).toBeNull();
    expect(getConversationIdFromUrl('https://chatgpt.com/other-page')).toBeNull();
    expect(getConversationIdFromUrl('https://example.com')).toBeNull();
  });

  it('returns null for null or undefined input', () => {
    expect(getConversationIdFromUrl(null)).toBeNull();
    expect(getConversationIdFromUrl(undefined)).toBeNull();
    expect(getConversationIdFromUrl('')).toBeNull();
  });

  it('handles invalid URLs gracefully', () => {
    expect(getConversationIdFromUrl('not-a-url')).toBeNull();
    expect(getConversationIdFromUrl('http://[invalid')).toBeNull();
  });
});

describe('getProjectIdFromUrl', () => {
  it('extracts project ID from /g/{id} pattern', () => {
    expect(getProjectIdFromUrl('https://chatgpt.com/g/proj-123')).toBe('proj-123');
    expect(getProjectIdFromUrl('https://chatgpt.com/g/abc456')).toBe('abc456');
  });

  it('extracts project ID from /g/{id}/project pattern', () => {
    expect(getProjectIdFromUrl('https://chatgpt.com/g/proj-123/project')).toBe('proj-123');
  });

  it('extracts project ID from /g/{id}/c/{cid} pattern', () => {
    expect(getProjectIdFromUrl('https://chatgpt.com/g/proj-123/c/conv-456')).toBe('proj-123');
  });

  it('handles URL-encoded project IDs', () => {
    expect(getProjectIdFromUrl('https://chatgpt.com/g/hello%20world')).toBe('hello world');
    expect(getProjectIdFromUrl('https://chatgpt.com/g/test%2F123')).toBe('test/123');
  });

  it('returns null for URLs without project ID', () => {
    expect(getProjectIdFromUrl('https://chatgpt.com/')).toBeNull();
    expect(getProjectIdFromUrl('https://chatgpt.com/c/conv-123')).toBeNull();
    expect(getProjectIdFromUrl('https://example.com')).toBeNull();
  });

  it('returns null for null or undefined input', () => {
    expect(getProjectIdFromUrl(null)).toBeNull();
    expect(getProjectIdFromUrl(undefined)).toBeNull();
    expect(getProjectIdFromUrl('')).toBeNull();
  });
});

describe('isProjectPage', () => {
  it('returns true for URLs with project ID', () => {
    expect(isProjectPage('https://chatgpt.com/g/proj-123')).toBe(true);
    expect(isProjectPage('https://chatgpt.com/g/abc/project')).toBe(true);
    expect(isProjectPage('https://chatgpt.com/g/xyz/c/conv-123')).toBe(true);
  });

  it('returns false for URLs without project ID', () => {
    expect(isProjectPage('https://chatgpt.com/')).toBe(false);
    expect(isProjectPage('https://chatgpt.com/c/conv-123')).toBe(false);
    expect(isProjectPage('https://example.com')).toBe(false);
  });

  it('returns false for null or undefined input', () => {
    expect(isProjectPage(null)).toBe(false);
    expect(isProjectPage(undefined)).toBe(false);
    expect(isProjectPage('')).toBe(false);
  });
});
