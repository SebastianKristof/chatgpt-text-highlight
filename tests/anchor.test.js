import { describe, it, expect } from 'vitest';
import { buildAnchor, findSelectionOffsets } from '../src/shared/anchor.js';

describe('buildAnchor', () => {
  it('builds an anchor with hash, prefix and offsets', () => {
    const anchor = buildAnchor({
      conversationId: 'conv-123',
      messageId: 'msg-1',
      messageText: 'Hello world, how are you?',
      selectionText: 'world, how',
      selectionStart: 6,
      selectionEnd: 16
    });

    expect(anchor.conversationId).toBe('conv-123');
    expect(anchor.messageId).toBe('msg-1');
    expect(anchor.textHash).toBeTruthy();
    expect(anchor.selectionPrefix).toBe('world, how');
    expect(anchor.selectionOffsets).toEqual({ start: 6, end: 16 });
  });

  it('normalizes empty messageId to null', () => {
    const anchor = buildAnchor({
      conversationId: 'conv-123',
      messageId: '',
      messageText: 'Hello world',
      selectionText: 'world',
      selectionStart: 6,
      selectionEnd: 11
    });

    expect(anchor.messageId).toBeNull();
  });

  it('truncates selection prefix to 32 characters', () => {
    const longText = 'a'.repeat(100);
    const anchor = buildAnchor({
      conversationId: 'conv-123',
      messageId: 'msg-1',
      messageText: 'Hello world',
      selectionText: longText,
      selectionStart: 0,
      selectionEnd: 100
    });

    expect(anchor.selectionPrefix.length).toBeLessThanOrEqual(32);
    expect(anchor.selectionPrefix).toBe(longText.substring(0, 32).trim());
  });

  it('handles null messageId', () => {
    const anchor = buildAnchor({
      conversationId: 'conv-123',
      messageId: null,
      messageText: 'Hello world',
      selectionText: 'world',
      selectionStart: 6,
      selectionEnd: 11
    });

    expect(anchor.messageId).toBeNull();
  });
});

describe('findSelectionOffsets', () => {
  it('returns null when message or selection text is missing', () => {
    expect(findSelectionOffsets('', 'foo')).toBeNull();
    expect(findSelectionOffsets('bar', '')).toBeNull();
  });

  it('finds exact selection with whitespace normalization', () => {
    const message = 'Hello   world  \n how are you?';
    const selection = 'world how are';
    const offsets = findSelectionOffsets(message, selection);

    expect(offsets).not.toBeNull();
    expect(offsets.start).toBeGreaterThanOrEqual(0);
    expect(offsets.end).toBeGreaterThan(offsets.start);
  });

  it('falls back to first-words matching when exact match fails', () => {
    // Message contains the first three words, but not the full selection.
    const message = 'This is a longer message that mentions unicorns eventually in space.';
    const selection = 'unicorns eventually in the sky';
    const offsets = findSelectionOffsets(message, selection);

    expect(offsets).not.toBeNull();
    expect(offsets.start).toBeGreaterThanOrEqual(0);
    expect(offsets.end).toBeGreaterThan(offsets.start);
  });

  it('returns null when no reasonable match is found', () => {
    const message = 'Completely different text';
    const selection = 'does not exist here';
    const offsets = findSelectionOffsets(message, selection);

    expect(offsets).toBeNull();
  });

  it('handles selection at start of message', () => {
    const message = 'Hello world';
    const selection = 'Hello';
    const offsets = findSelectionOffsets(message, selection);

    expect(offsets).not.toBeNull();
    expect(offsets.start).toBe(0);
  });

  it('handles selection at end of message', () => {
    const message = 'Hello world';
    const selection = 'world';
    const offsets = findSelectionOffsets(message, selection);

    expect(offsets).not.toBeNull();
    expect(offsets.end).toBeLessThanOrEqual(message.length);
  });

  it('handles null or undefined inputs', () => {
    expect(findSelectionOffsets(null, 'test')).toBeNull();
    expect(findSelectionOffsets('test', null)).toBeNull();
    expect(findSelectionOffsets(undefined, 'test')).toBeNull();
    expect(findSelectionOffsets('test', undefined)).toBeNull();
  });
});

