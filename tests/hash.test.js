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
});

