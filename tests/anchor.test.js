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
});

