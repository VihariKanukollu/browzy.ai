import { SESSION_DIGEST_PROMPT } from '../prompts.js';
import type { LLMProvider } from '../llm/provider.js';

/**
 * Generate a 2-3 sentence digest of a browzy session.
 * Used for session memory — shows users where they left off.
 */
export async function generateSessionDigest(
  messages: Array<{ role: string; content: string }>,
  llm: LLMProvider,
): Promise<string> {
  // Only include user questions and truncated assistant answers
  const summary = messages
    .filter(m => m.role !== 'system')
    .map(m =>
      m.role === 'user'
        ? `Q: ${m.content}`
        : `A: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`,
    )
    .join('\n');

  const response = await llm.chat(
    [{ role: 'user', content: summary }],
    { system: SESSION_DIGEST_PROMPT, maxTokens: 200 },
  );
  return response.content.trim();
}
