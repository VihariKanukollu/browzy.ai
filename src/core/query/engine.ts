import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import type { LLMProvider } from '../llm/provider.js';
import type { WikiArticle } from '../types.js';

const SYSTEM_PROMPT = `You are a research assistant with access to a personal knowledge base wiki. Answer questions by synthesizing information from the wiki articles provided as context.

Rules:
- Cite specific articles using [[article-slug]] notation
- Be precise and factual — only state what the wiki supports
- If the wiki doesn't contain enough information, say so clearly
- When asked to generate output (reports, slides, etc.), use the appropriate format`;

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

    this.db.close();
    return result;
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
          content: `Extract 3-5 key search terms from this question for searching a research wiki. Output only the terms, one per line.\n\nQuestion: ${question}`,
        },
      ],
      { maxTokens: 256 }
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
        return `Output your answer as a Marp slide deck. Use this format:
---
marp: true
theme: default
---

# Slide Title

Content here

---

# Next Slide

More content`;
      case 'json':
        return 'Output your answer as a JSON object with "title", "summary", "sections" (array of {heading, content}), and "sources" fields.';
      case 'markdown':
      default:
        return 'Output your answer as well-structured markdown with headers, lists, and citations.';
    }
  }
}
