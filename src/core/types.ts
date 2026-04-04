/**
 * Core types for browzy.ai
 */

// ── Source & Ingest ──────────────────────────────────────────────

export type SourceType = 'web' | 'pdf' | 'image' | 'text' | 'markdown';

export interface RawSource {
  id: string;
  type: SourceType;
  title: string;
  /** Original URL or file path */
  origin: string;
  /** Path to the ingested .md file in raw/ */
  path: string;
  /** Paths to associated images */
  images: string[];
  /** When this source was ingested */
  ingestedAt: string;
  /** Original ingest timestamp preserved across re-ingests */
  firstIngestedAt?: string;
  /** True when this source was re-ingested (updated) */
  isUpdate?: boolean;
  /** Brief LLM-generated summary */
  summary?: string;
  /** Extracted tags/topics */
  tags?: string[];
  /** SHA-256 hash of original file content (for dedup without re-reading) */
  contentHash?: string;
}

// ── Wiki ─────────────────────────────────────────────────────────

export interface ArticleFrontmatter {
  title: string;
  tags: string[];
  sources: string[];
  backlinks: string[];
  created: string;
  updated: string;
  summary: string;
}

export interface WikiArticle {
  /** Filename without extension, used as article ID */
  slug: string;
  frontmatter: ArticleFrontmatter;
  content: string;
  /** Full file path */
  path: string;
}

export interface WikiIndex {
  articles: Array<{
    slug: string;
    title: string;
    summary: string;
    tags: string[];
  }>;
  concepts: Array<{
    name: string;
    articles: string[];
  }>;
  lastCompiled: string;
}

// ── LLM ──────────────────────────────────────────────────────────

export type LLMProviderName = 'claude' | 'openai' | 'openrouter';

export interface LLMConfig {
  provider: LLMProviderName;
  apiKey: string;
  model?: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<TextContent | ImageContent>;
}

export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ── Config ───────────────────────────────────────────────────────

export interface BrowzyConfig {
  /** Path to the knowledge base data directory */
  dataDir: string;
  llm: LLMConfig;
  /** Optional secondary LLM for fallback */
  fallbackLlm?: LLMConfig;
  /** Compilation settings */
  compile: {
    /** Max articles to update per compile run */
    batchSize: number;
    /** Whether to auto-extract concepts */
    extractConcepts: boolean;
  };
  /** Clipboard watcher — opt-in, OFF by default */
  clipboard?: { enabled: boolean };
}

// ── Storage ──────────────────────────────────────────────────────

export interface SearchResult {
  slug: string;
  title: string;
  snippet: string;
  score: number;
}

// ── Lint ──────────────────────────────────────────────────────────

export type LintSeverity = 'error' | 'warning' | 'suggestion';

export interface LintIssue {
  severity: LintSeverity;
  article: string;
  message: string;
  suggestion?: string;
}
