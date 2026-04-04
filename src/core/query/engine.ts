import { FilesystemStorage } from '../storage/filesystem.js';
import type { LLMProvider } from '../llm/provider.js';
import { QUERY_SYSTEM_PROMPT as SYSTEM_PROMPT, SEARCH_EXTRACTION_PROMPT, MARP_OUTPUT_PROMPT, JSON_OUTPUT_PROMPT } from '../prompts.js';
import { ContextBuilder } from '../retrieval/contextBuilder.js';
import { calculateBudget } from '../retrieval/tokenCounter.js';
import { queryCache } from '../retrieval/queryCache.js';

export interface QueryResult {
  answer: string;
  sourcesUsed: string[];
  outputPath?: string;
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  tokensBudget?: { used: number; total: number };
}

/** Prepared query — context built, prompt ready, no LLM call yet. */
export interface PreparedQuery {
  prompt: string;
  systemPrompt: string;
  sourcesUsed: string[];
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
  tokensBudget: { used: number; total: number };
}

export type OutputFormat = 'markdown' | 'marp' | 'json';

export class QueryEngine {
  private fs: FilesystemStorage;
  private llm: LLMProvider;
  private dataDir: string;
  /** Track which articles were used in previous queries this session */
  private usedSlugs = new Set<string>();

  constructor(dataDir: string, llm: LLMProvider) {
    this.dataDir = dataDir;
    this.fs = new FilesystemStorage(dataDir);
    this.llm = llm;
  }

  /**
   * Answer a question using relevance-ranked article context.
   */
  async query(
    question: string,
    options?: {
      format?: OutputFormat;
      save?: boolean;
      model?: string;
      followUp?: boolean;  // If true, exclude previously-used articles
      conversationHistory?: Array<{ role: string; content: string }>;
    }
  ): Promise<QueryResult> {
    const format = options?.format ?? 'markdown';
    const save = options?.save ?? false;
    const model = options?.model ?? 'claude-sonnet-4-20250514';

    // Check query cache for identical prior result (skip for follow-ups)
    const isFollowUp = options?.followUp;
    if (!isFollowUp) {
      const cached = queryCache.get(question, format, model);
      if (cached) return cached as QueryResult;
    }

    // 1. Calculate token budget
    const budget = calculateBudget(
      model,
      SYSTEM_PROMPT,
      options?.conversationHistory ?? [],
    );

    // 2. Build context with relevance ranking + budget enforcement
    const contextBuilder = new ContextBuilder(this.dataDir);
    const builtContext = contextBuilder.build(question, {
      articleBudget: budget.articleBudget,
      excludeSlugs: options?.followUp ? this.usedSlugs : undefined,
    });

    // Track used articles for follow-up awareness
    for (const scored of builtContext.articlesUsed) {
      this.usedSlugs.add(scored.article.slug);
    }

    // 3. Build the prompt
    const formatInstruction = this.getFormatInstruction(format);
    const confidenceNote = builtContext.confidence === 'low'
      ? '\n\nNote: Your browzy has limited coverage on this topic. Flag what you know vs what you\'re inferring from general knowledge.'
      : '';

    const gapNote = builtContext.gaps.length > 0
      ? `\n\nCoverage gaps detected for: ${builtContext.gaps.join(', ')}. Suggest sources the user could add.`
      : '';

    const prompt = `${builtContext.context}${confidenceNote}${gapNote}

QUESTION: ${question}

${formatInstruction}`;

    // 4. Query the LLM
    const response = await this.llm.chat(
      [{ role: 'user', content: prompt }],
      { system: SYSTEM_PROMPT, maxTokens: 8192 }
    );

    const sourcesUsed = builtContext.articlesUsed.map(a => a.article.slug);

    const result: QueryResult = {
      answer: response.content,
      sourcesUsed,
      confidence: builtContext.confidence,
      gaps: builtContext.gaps,
      tokensBudget: {
        used: response.usage?.inputTokens ?? builtContext.tokenCount,
        total: budget.contextWindow,
      },
    };

    // 5. Cache the result for future identical queries (skip for follow-ups)
    if (!isFollowUp) {
      queryCache.set(question, format, model, result);
    }

    // 6. Save output if requested
    if (save) {
      const ext = format === 'json' ? 'json' : 'md';
      const filename = `query-${Date.now()}.${ext}`;
      result.outputPath = this.fs.writeOutput(filename, response.content);
    }

    return result;
  }

  /**
   * Build context and prompt without calling the LLM.
   * Use this when you want to stream the response yourself.
   */
  prepare(
    question: string,
    options?: {
      format?: OutputFormat;
      model?: string;
      followUp?: boolean;
      conversationHistory?: Array<{ role: string; content: string }>;
    }
  ): PreparedQuery {
    const format = options?.format ?? 'markdown';
    const model = options?.model ?? 'claude-sonnet-4-20250514';

    const budget = calculateBudget(
      model,
      SYSTEM_PROMPT,
      options?.conversationHistory ?? [],
    );

    const contextBuilder = new ContextBuilder(this.dataDir);
    const builtContext = contextBuilder.build(question, {
      articleBudget: budget.articleBudget,
      excludeSlugs: options?.followUp ? this.usedSlugs : undefined,
    });

    for (const scored of builtContext.articlesUsed) {
      this.usedSlugs.add(scored.article.slug);
    }

    const formatInstruction = this.getFormatInstruction(format);
    const confidenceNote = builtContext.confidence === 'low'
      ? '\n\nNote: Your browzy has limited coverage on this topic. Flag what you know vs what you\'re inferring from general knowledge.'
      : '';
    const gapNote = builtContext.gaps.length > 0
      ? `\n\nCoverage gaps detected for: ${builtContext.gaps.join(', ')}. Suggest sources the user could add.`
      : '';

    const prompt = `${builtContext.context}${confidenceNote}${gapNote}\n\nQUESTION: ${question}\n\n${formatInstruction}`;

    return {
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      sourcesUsed: builtContext.articlesUsed.map(a => a.article.slug),
      confidence: builtContext.confidence,
      gaps: builtContext.gaps,
      tokensBudget: {
        used: builtContext.tokenCount,
        total: budget.contextWindow,
      },
    };
  }

  /**
   * Reset follow-up tracking (e.g., when topic changes).
   */
  resetFollowUp(): void {
    this.usedSlugs.clear();
  }

  private getFormatInstruction(format: OutputFormat): string {
    switch (format) {
      case 'marp':
        return MARP_OUTPUT_PROMPT;
      case 'json':
        return JSON_OUTPUT_PROMPT;
      case 'markdown':
      default:
        return 'Output your answer as well-structured markdown with headers, lists, and citations using [[article-slug]] notation.';
    }
  }
}
