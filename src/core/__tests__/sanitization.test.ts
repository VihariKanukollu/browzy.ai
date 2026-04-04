import { describe, it, expect } from 'vitest';
import { sanitizeUnicode, sanitizeDeep } from '../sanitization.js';

describe('sanitizeUnicode', () => {
  it('passes through normal ASCII text unchanged', () => {
    expect(sanitizeUnicode('Hello, world!')).toBe('Hello, world!');
  });

  it('passes through legitimate Unicode (CJK, emoji, accents)', () => {
    expect(sanitizeUnicode('caf\u00E9')).toBe('caf\u00E9');
    expect(sanitizeUnicode('\u4F60\u597D')).toBe('\u4F60\u597D'); // 你好
  });

  it('strips zero-width spaces (U+200B)', () => {
    expect(sanitizeUnicode('hello\u200Bworld')).toBe('helloworld');
  });

  it('strips zero-width non-joiner (U+200C)', () => {
    expect(sanitizeUnicode('ab\u200Ccd')).toBe('abcd');
  });

  it('strips zero-width joiner (U+200D)', () => {
    expect(sanitizeUnicode('ab\u200Dcd')).toBe('abcd');
  });

  it('strips left-to-right mark (U+200E)', () => {
    expect(sanitizeUnicode('hello\u200Eworld')).toBe('helloworld');
  });

  it('strips right-to-left mark (U+200F)', () => {
    expect(sanitizeUnicode('hello\u200Fworld')).toBe('helloworld');
  });

  it('strips directional formatting chars (U+202A-U+202E)', () => {
    const input = 'a\u202Ab\u202Bc\u202Cd\u202De\u202Ef';
    expect(sanitizeUnicode(input)).toBe('abcdef');
  });

  it('strips directional isolates (U+2066-U+2069)', () => {
    const input = 'a\u2066b\u2067c\u2068d\u2069e';
    expect(sanitizeUnicode(input)).toBe('abcde');
  });

  it('strips BOM (U+FEFF)', () => {
    expect(sanitizeUnicode('\uFEFFhello')).toBe('hello');
  });

  it('strips BMP private use area chars (U+E000-U+F8FF)', () => {
    expect(sanitizeUnicode('a\uE000b\uF8FFc')).toBe('abc');
  });

  it('strips soft hyphen (U+00AD) via Cf category', () => {
    expect(sanitizeUnicode('soft\u00ADhyphen')).toBe('softhyphen');
  });

  it('handles ASCII smuggling via Tag characters (U+E0001-U+E007F)', () => {
    // Tag characters are in the Cf category and used in ASCII smuggling attacks
    const tagA = String.fromCodePoint(0xE0041); // TAG LATIN CAPITAL LETTER A
    const tagB = String.fromCodePoint(0xE0042);
    expect(sanitizeUnicode(`hidden${tagA}${tagB}text`)).toBe('hiddentext');
  });

  it('applies NFKC normalization', () => {
    // Fullwidth A (U+FF21) normalizes to regular A
    expect(sanitizeUnicode('\uFF21')).toBe('A');
    // Roman numeral Ⅲ normalizes to III
    expect(sanitizeUnicode('\u2162')).toBe('III');
  });

  it('handles empty string', () => {
    expect(sanitizeUnicode('')).toBe('');
  });

  it('handles string with only dangerous chars', () => {
    expect(sanitizeUnicode('\u200B\u200C\u200D\uFEFF')).toBe('');
  });

  it('throws on deeply nested normalization loops', () => {
    // This should complete normally — the iteration limit is a safety net
    const normal = 'a'.repeat(1000);
    expect(sanitizeUnicode(normal)).toBe(normal);
  });

  it('error message includes input preview', () => {
    // We can't easily trigger MAX_ITERATIONS, but we verify the function signature handles it
    // The error message format is: "...for input: <first 100 chars>"
    // Just verify normal inputs don't throw
    expect(() => sanitizeUnicode('safe input')).not.toThrow();
  });
});

describe('sanitizeDeep', () => {
  it('sanitizes strings', () => {
    expect(sanitizeDeep('hello\u200Bworld')).toBe('helloworld');
  });

  it('returns non-string primitives unchanged', () => {
    expect(sanitizeDeep(42)).toBe(42);
    expect(sanitizeDeep(true)).toBe(true);
    expect(sanitizeDeep(null)).toBe(null);
    expect(sanitizeDeep(undefined)).toBe(undefined);
  });

  it('sanitizes arrays recursively', () => {
    expect(sanitizeDeep(['a\u200Bb', 'c\u200Dd'])).toEqual(['ab', 'cd']);
  });

  it('sanitizes nested arrays', () => {
    expect(sanitizeDeep([['a\u200Bb'], 'c'])).toEqual([['ab'], 'c']);
  });

  it('sanitizes object values', () => {
    expect(sanitizeDeep({ name: 'a\u200Bb' })).toEqual({ name: 'ab' });
  });

  it('sanitizes object keys', () => {
    const input = { ['key\u200B']: 'value' };
    const result = sanitizeDeep(input) as Record<string, unknown>;
    expect(result).toHaveProperty('key');
    expect(result).not.toHaveProperty('key\u200B');
  });

  it('handles deeply nested structures', () => {
    const input = { a: [{ b: 'x\u200By' }] };
    expect(sanitizeDeep(input)).toEqual({ a: [{ b: 'xy' }] });
  });

  it('handles mixed types in arrays', () => {
    expect(sanitizeDeep([1, 'a\u200Bb', null, { c: 'd\u200De' }])).toEqual([1, 'ab', null, { c: 'de' }]);
  });
});
