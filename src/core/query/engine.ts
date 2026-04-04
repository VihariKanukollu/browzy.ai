import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import type { LLMProvider } from '../llm/provider.js';
import type { WikiArticle } from '../types.js';
import { QUERY_SYSTEM_PROMPT as SYSTEM_PROMPT, SEARCH_EXTRACTION_PROMPT, MARP_OUTPUT_PROMPT, JSON_OUTPUT_PROMPT } from '../prompts.js';

export interface QueryResult {
  answer: string;
  sourcesUsed: string[];
  /** If the answer was saved as an output file */
  outputPath?: string;
}

export type OutputFormat = 'markdown' | 'marp' | 'json';

export class QueryEngine {
  private fs: FilesystemStorage;
  private db: SQLiteStorage;
  private llm: LLMProvider;
  private dataDir: string;

  constructor(dataDir: string, llm: LLMProvider) {
    this.dataDir = dataDir;
    this.fs = new FilesystemStorage(dataDir);
    this.db = new SQLiteStorage(dataDir);
    this.llm = llm;
  }

  /**
   * Answer a question using the wiki as context.
   */
  async query(
    question: string,
    options?: { format?: OutputFormat; save?: boolean }
  ): Promise<QueryResult> {
    const format = options?.format ?? 'markdown';
    const save = options?.save ?? false;

    try {
      // 1. Find relevant articles via FTS search
      const searchTerms = await this.extractSearchTerms(question);
      const relevantArticles = await this.gatherContext(searchTerms);

      // 2. Build context from articles
      const context = this.buildContext(relevantArticles);

      // 3. Query the LLM
      const formatInstruction = this.getFormatInstruction(format);
      const prompt = `${context}

QUESTION: ${question}

${formatInstruction}`;

      const response = await this.llm.chat(
        [{ role: 'user', content: prompt }],
        { system: SYSTEM_PROMPT, maxTokens: 8192 }
      );

      const sourcesUsed = relevantArticles.map(a => a.slug);
      const result: QueryResult = {
        answer: response.content,
        sourcesUsed,
      };

      // 4. Save output if requested
      if (save) {
        const ext = format === 'json' ? 'json' : 'md';
        const filename = `query-${Date.now()}.${ext}`;
        result.outputPath = this.fs.writeOutput(filename, response.content);
      }

      return result;
    } finally {
      this.db.close();
    }
  }

  /**
   * Use LLM to extract good search terms from the question.
   */
  private async extractSearchTerms(question: string): Promise<string[]> {
    // First try direct FTS — often good enough
    const directResults = this.db.search(question, 5);
    if (directResults.length >= 3) {
      return [question];
    }

    // Ask LLM for better search terms
    const response = await this.llm.chat(
      [
        {
          role: 'user',
          content: `Question: ${question}`,
        },
      ],
      { system: SEARCH_EXTRACTION_PROMPT, maxTokens: 256 }
    );

    const terms = response.content
      .split('\n')
      .map(t => t.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(t => t.length > 0);

    return terms.length > 0 ? terms : [question];
  }

  private async gatherContext(searchTerms: string[]): Promise<WikiArticle[]> {
    const slugs = new Set<string>();
    const articles: WikiArticle[] = [];

    // Search for each term
    for (const term of searchTerms) {
      try {
        const results = this.db.search(term, 5);
        for (const r of results) {
          if (!slugs.has(r.slug)) {
            slugs.add(r.slug);
            const article = this.fs.readArticle(r.slug);
            if (article) articles.push(article);
          }
        }
      } catch {
        // FTS query syntax errors — skip
      }
    }

    // If no search results, fall back to loading the index
    if (articles.length === 0) {
      const index = this.fs.readIndex();
      if (index) {
        for (const entry of index.articles.slice(0, 10)) {
          const article = this.fs.readArticle(entry.slug);
          if (article) articles.push(article);
        }
      }
    }

    return articles;
  }

  private buildContext(articles: WikiArticle[]): string {
    if (articles.length === 0) {
      return 'WIKI CONTEXT: No relevant articles found in the knowledge base.';
    }

    const sections = articles.map(a => {
      // Truncate very long articles to stay within context
      const content = a.content.length > 5000
        ? a.content.slice(0, 5000) + '\n\n[...truncated]'
        : a.content;

      return `### [[${a.slug}]] — ${a.frontmatter.title}\nTags: ${a.frontmatter.tags.join(', ')}\n\n${content}`;
    });

    return `WIKI CONTEXT (${articles.length} articles):\n\n${sections.join('\n\n---\n\n')}`;
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
