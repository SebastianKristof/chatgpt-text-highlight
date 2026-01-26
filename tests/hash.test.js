import { describe, it, expect } from 'vitest';
import { hashText } from '../src/shared/hash.js';

describe('hashText', () => {
  it('returns empty string for falsy input', () => {
    expect(hashText('')).toBe('');
    expect(hashText(null)).toBe('');
    expect(hashText(undefined)).toBe('');
  });

  it('produces a stable hash for the same text', () => {
    const a = hashText('hello world');
    const b = hashText('hello world');
    expect(a).toBe(b);
  });

  it('normalizes whitespace before hashing', () => {
    const a = hashText('  hello   world\n');
    const b = hashText('hello world');
    expect(a).toBe(b);
  });

  it('produces different hashes for different content', () => {
    const a = hashText('foo');
    const b = hashText('bar');
    expect(a).not.toBe(b);
  });

  it('handles special characters', () => {
    const hash1 = hashText('hello@world.com');
    const hash2 = hashText('hello@world.com');
    expect(hash1).toBe(hash2);
  });

  it('handles unicode characters', () => {
    const hash1 = hashText('Hello 世界');
    const hash2 = hashText('Hello 世界');
    expect(hash1).toBe(hash2);
  });

  it('handles very long text', () => {
    const longText = 'a'.repeat(10000);
    const hash = hashText(longText);
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
  });

  it('returns non-empty hash for non-empty input', () => {
    const hash = hashText('a');
    expect(hash).toBeTruthy();
    expect(hash.length).toBeGreaterThan(0);
  });
});

