/**
 * Conversation compaction — summarizes older conversation turns
 * to free up context window for new content.
 *
 * Follows Claude Code's 9-section compaction prompt pattern
 * adapted for knowledge base Q&A rather than coding sessions.
 *
 * Reference: Claude Code's compact.ts + prompt.ts
 * - Reserves 20K tokens for summary output
 * - Auto-compacts at (context_window - 13K)
 * - Circuit breaker after 3 consecutive failures
 */

import type { LLMProvider } from '../llm/provider.js';

export interface CompactMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const COMPACTION_PROMPT = `Your task is to create a detailed summary of the research conversation so far. This summary will replace the earlier messages, so it must capture everything needed to continue the research session without losing context.

CRITICAL: Respond with TEXT ONLY. Do NOT attempt to call any tools or perform any actions. Your ONLY job is to produce a summary.

Your summary MUST include these sections:

1. **Research Topic & Intent**: What is the user researching? What are their goals? What specific questions are they trying to answer?

2. **Key Findings**: What important facts, data, concepts, and connections have been surfaced from the knowledge base? Include specific numbers, formulas, and quotes.

3. **Articles Referenced**: List every knowledge base article cited in the conversation, with its slug and a one-line summary of what was used from it. Format: [[slug]] — what was cited.

4. **User Questions & Answers**: List each question the user asked and a brief summary of the answer given. This preserves the research thread.

5. **Connections Discovered**: Any cross-article connections, contradictions, or insights that emerged during the conversation.

6. **User Feedback & Corrections**: Any corrections the user made, preferences they expressed, or things they said were wrong or unhelpful. These MUST be preserved to avoid repeating mistakes.

7. **Pending Questions**: Any questions that were asked but not fully answered, or follow-up threads that were opened but not pursued.

8. **Current Thread**: What was the most recent topic being discussed? Include enough detail that the next response can continue seamlessly.

Produce your summary inside <summary> tags. Be thorough — err on the side of including too much rather than too little. This summary is the only record of the conversation.`;

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Compact a conversation by summarizing older messages.
 * Keeps the most recent N messages intact, summarizes the rest.
 */
export async function compactConversation(
  messages: CompactMessage[],
  llm: LLMProvider,
  keepRecentCount = 4,
): Promise<{ summary: string; keptMessages: CompactMessage[] }> {
  if (messages.length <= keepRecentCount + 1) {
    // Not enough to compact
    return { summary: '', keptMessages: messages };
  }

  // Split: older messages to summarize, recent to keep
  const toSummarize = messages.slice(0, messages.length - keepRecentCount);
  const toKeep = messages.slice(messages.length - keepRecentCount);

  // Build the conversation text for summarization
  const conversationText = toSummarize
    .map(m => {
      const prefix = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      // Truncate very long messages for the summarizer
      const content = m.content.length > 3000 ? m.content.slice(0, 3000) + '\n[...truncated]' : m.content;
      return `${prefix}: ${content}`;
    })
    .join('\n\n');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_CONSECUTIVE_FAILURES; attempt++) {
    try {
      const response = await llm.chat(
        [{ role: 'user', content: `Here is the conversation to summarize:\n\n${conversationText}` }],
        { system: COMPACTION_PROMPT, maxTokens: 4096 }
      );

      // Extract summary from <summary> tags
      const summaryMatch = response.content.match(/<summary>([\s\S]*?)<\/summary>/);
      const summary = summaryMatch ? summaryMatch[1].trim() : response.content.trim();

      return {
        summary,
        keptMessages: [
          { role: 'system', content: `[Previous conversation summary]\n\n${summary}` },
          ...toKeep,
        ],
      };
    } catch (err: any) {
      lastError = err;
      // Brief backoff before retry
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  // Circuit breaker: all retries failed, return messages unmodified
  console.error('Compaction failed after retries:', lastError?.message);
  return { summary: '', keptMessages: messages };
}
