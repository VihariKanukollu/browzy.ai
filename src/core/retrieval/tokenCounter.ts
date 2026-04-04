/**
 * Token estimation for context window management.
 *
 * Uses a segmented heuristic that accounts for different content types:
 * - Code blocks: ~3.5 chars/token (more symbols & short identifiers)
 * - CJK characters: ~2 chars/token
 * - Whitespace-heavy regions: ~5 chars/token (collapses in tokenizers)
 * - Prose: ~4 chars/token (standard English)
 *
 * Not exact, but significantly more accurate than a flat ratio.
 *
 * Reference: Claude Code uses exact token counts from API usage fields.
 * We approximate since we don't have a local tokenizer.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;

  let totalTokens = 0;
  let remaining = text;

  // Extract and count code blocks separately (```...```)
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = remaining.match(codeBlockRegex) || [];
  for (const block of codeBlocks) {
    totalTokens += Math.ceil(block.length / 3.5);
    remaining = remaining.replace(block, '');
  }

  // Count CJK characters (Chinese, Japanese, Korean) — roughly 2 chars per token
  const cjkRegex = /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g;
  const cjkChars = remaining.match(cjkRegex) || [];
  totalTokens += Math.ceil(cjkChars.length / 2);
  remaining = remaining.replace(cjkRegex, '');

  // Count whitespace-heavy sections (multiple newlines, indentation)
  const whitespaceHeavy = remaining.match(/\s{2,}/g);
  let whitespaceChars = 0;
  if (whitespaceHeavy) {
    for (const ws of whitespaceHeavy) whitespaceChars += ws.length;
  }
  totalTokens += Math.ceil(whitespaceChars / 5);
  remaining = remaining.replace(/\s{2,}/g, ' ');

  // Remaining prose — standard 4 chars per token
  totalTokens += Math.ceil(remaining.length / 4);

  return totalTokens;
}

export function estimateTokensForMessages(messages: Array<{ content: string }>): number {
  // Each message has ~4 tokens of overhead (role, delimiters)
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/**
 * Context window sizes per model family.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5': 16385,
  'o1': 200000,
  'o3': 200000,
  'o4': 200000,
  'default': 128000,
};

export function getContextWindow(model: string): number {
  for (const [prefix, window] of Object.entries(CONTEXT_WINDOWS)) {
    if (model.includes(prefix)) return window;
  }
  return CONTEXT_WINDOWS.default;
}

/**
 * Budget allocation for a query.
 * Reference: Claude Code reserves 20K for summary output, 13K buffer.
 */
export interface TokenBudget {
  contextWindow: number;
  systemPromptTokens: number;
  conversationTokens: number;
  articleBudget: number;       // How many tokens available for wiki articles
  outputReserve: number;       // Reserved for LLM response
  remaining: number;           // Free tokens after everything
  isNearLimit: boolean;        // Within 20K of limit
  needsCompaction: boolean;    // Within 13K of limit
}

const OUTPUT_RESERVE = 8192;
const COMPACTION_BUFFER = 13000;
const WARNING_BUFFER = 20000;

export function calculateBudget(
  model: string,
  systemPrompt: string,
  conversationHistory: Array<{ content: string }>,
): TokenBudget {
  const contextWindow = getContextWindow(model);
  const systemPromptTokens = estimateTokens(systemPrompt);
  const conversationTokens = estimateTokensForMessages(conversationHistory);
  const used = systemPromptTokens + conversationTokens + OUTPUT_RESERVE;
  const remaining = contextWindow - used;
  const articleBudget = Math.max(0, remaining - COMPACTION_BUFFER);

  return {
    contextWindow,
    systemPromptTokens,
    conversationTokens,
    articleBudget,
    outputReserve: OUTPUT_RESERVE,
    remaining,
    isNearLimit: remaining < WARNING_BUFFER,
    needsCompaction: remaining < COMPACTION_BUFFER,
  };
}
