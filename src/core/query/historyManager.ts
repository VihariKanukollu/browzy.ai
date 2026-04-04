/**
 * Smart conversation history builder for LLM context.
 *
 * Filters out system messages (milestones, gap suggestions, streak notifications)
 * and applies intelligent truncation: recent messages are kept at full length
 * while older messages are progressively shortened to stay within token budgets.
 */

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface HistoryMessage {
  role: string;
  content: string;
}

export function buildLLMHistory(
  messages: HistoryMessage[],
  options: {
    maxMessages?: number;    // default 10
    maxCharsPerMsg?: number; // default 1000 chars (~250 tokens)
    maxTotalChars?: number;  // default 4000 chars (~1000 tokens)
  } = {}
): ConversationMessage[] {
  const {
    maxMessages = 10,
    maxCharsPerMsg = 1000,
    maxTotalChars = 4000,
  } = options;

  // Step 1: Filter to only user and assistant messages (no system messages)
  const relevant = messages.filter(
    (m): m is HistoryMessage & { role: 'user' | 'assistant' } =>
      m.role === 'user' || m.role === 'assistant'
  );

  // Step 2: Take the most recent N messages
  const recent = relevant.slice(-maxMessages);

  // Step 3: Smart truncation — keep recent messages full, truncate older ones
  let totalChars = 0;
  const result: ConversationMessage[] = [];

  // Process from newest to oldest
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    let content = msg.content;

    // Keep the last 2 messages (current exchange) at full length
    if (i >= recent.length - 2) {
      // Full content, just cap at double maxCharsPerMsg
      if (content.length > maxCharsPerMsg * 2) {
        content = content.slice(0, maxCharsPerMsg * 2) + '...';
      }
    } else {
      // Older messages: truncate more aggressively
      if (content.length > maxCharsPerMsg) {
        content = content.slice(0, maxCharsPerMsg) + '...';
      }
    }

    totalChars += content.length;
    if (totalChars > maxTotalChars && result.length >= 2) {
      break; // Stop adding older messages if we've exceeded budget
    }

    result.unshift({
      role: msg.role,
      content,
    });
  }

  return result;
}
