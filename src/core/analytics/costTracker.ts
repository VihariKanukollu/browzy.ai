/**
 * Cost and token tracking for browzy.ai LLM usage.
 * Tracks per-query and session-level costs based on model pricing.
 */

export interface QueryCost {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  model: string;
}

/** Per-1M-token pricing (approximate, USD) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-sonnet': { input: 3, output: 15 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-opus': { input: 15, output: 75 },
  'claude-haiku': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o3': { input: 10, output: 40 },
  'o4': { input: 10, output: 40 },
  'ollama': { input: 0, output: 0 },
  // Local Ollama model families — always free
  'llama': { input: 0, output: 0 },
  'qwen': { input: 0, output: 0 },
  'gemma': { input: 0, output: 0 },
  'phi': { input: 0, output: 0 },
  'codellama': { input: 0, output: 0 },
  // Cloud model pricing
  'deepseek': { input: 0.27, output: 1.1 },
  'mistral': { input: 0.3, output: 0.9 },
};

class CostTracker {
  private sessionCosts: QueryCost[] = [];

  recordQuery(model: string, usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  }): QueryCost {
    const pricing = this.findPricing(model);
    const inputCost = usage.inputTokens * pricing.input / 1_000_000;
    const outputCost = usage.outputTokens * pricing.output / 1_000_000;
    // Cache costs are additive because Anthropic's `input_tokens` field already
    // excludes cached tokens. cacheWriteTokens are billed at 1.25x input rate,
    // cacheReadTokens at 0.1x input rate — both on top of the base input cost.
    const cacheCost = (
      (usage.cacheWriteTokens || 0) * pricing.input * 1.25 +
      (usage.cacheReadTokens || 0) * pricing.input * 0.1
    ) / 1_000_000;
    const cost = inputCost + outputCost + cacheCost;
    const entry: QueryCost = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: cost,
      model,
    };
    this.sessionCosts.push(entry);
    return entry;
  }

  get sessionTotal(): { tokens: number; cost: number; queries: number } {
    return {
      tokens: this.sessionCosts.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0),
      cost: this.sessionCosts.reduce((sum, c) => sum + c.estimatedCost, 0),
      queries: this.sessionCosts.length,
    };
  }

  get lastQuery(): QueryCost | null {
    return this.sessionCosts.at(-1) ?? null;
  }

  private findPricing(model: string): { input: number; output: number } {
    const lower = model.toLowerCase();
    for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
      if (lower.startsWith(prefix) || lower.includes(prefix)) return pricing;
    }
    // Default to sonnet pricing as a reasonable middle ground
    return { input: 3, output: 15 };
  }

  formatLastQuery(): string {
    const last = this.lastQuery;
    if (!last) return '';
    return `$${last.estimatedCost.toFixed(3)} this query`;
  }

  formatSession(): string {
    const total = this.sessionTotal;
    if (total.queries === 0) return '';
    const tokensK = (total.tokens / 1000).toFixed(1);
    return `$${total.cost.toFixed(2)} session \u00b7 ${tokensK}K tokens`;
  }

  /** Combined display string for the status bar */
  formatStatus(): string {
    const parts: string[] = [];
    const last = this.formatLastQuery();
    if (last) parts.push(last);
    // Skip session total on first query — it's identical to the query cost
    const total = this.sessionTotal;
    if (total.queries > 1) {
      const session = this.formatSession();
      if (session) parts.push(session);
    }
    return parts.join(' \u00b7 ');
  }

  reset(): void {
    this.sessionCosts = [];
  }
}

export const costTracker = new CostTracker();
