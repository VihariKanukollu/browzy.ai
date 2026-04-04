/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * Protects against ASCII Smuggling and Hidden Prompt Injection using
 * invisible Unicode characters (Tag characters, format controls, private use areas).
 *
 * Based on mitigations for HackerOne report #3086545.
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 */

const MAX_ITERATIONS = 10;

export function sanitizeUnicode(input: string): string {
  let current = input;
  let previous = '';
  let iterations = 0;

  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current;

    // NFKC normalization to handle composed character sequences
    current = current.normalize('NFKC');

    // Remove dangerous Unicode categories: Format, Private Use, Unassigned
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '');

    // Explicit fallback ranges for environments without full Unicode property support
    current = current
      .replace(/[\u200B-\u200F]/g, '')     // Zero-width spaces, LTR/RTL marks
      .replace(/[\u202A-\u202E]/g, '')     // Directional formatting
      .replace(/[\u2066-\u2069]/g, '')     // Directional isolates
      .replace(/[\uFEFF]/g, '')            // Byte order mark
      .replace(/[\uE000-\uF8FF]/g, '');   // BMP private use area

    iterations++;
  }

  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${input.slice(0, 100)}`
    );
  }

  return current;
}

export function sanitizeDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUnicode(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[sanitizeDeep(key) as string] = sanitizeDeep(val);
    }
    return sanitized;
  }
  return value;
}
