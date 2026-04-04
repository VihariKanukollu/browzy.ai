/**
 * Context builder — assembles the optimal set of article content
 * for a given query within the available token budget.
 *
 * Pipeline:
 * 1. FTS search for candidate articles
 * 2. Relevance ranking with multi-signal scoring
 * 3. Section-level extraction (only include relevant parts)
 * 4. Token budget enforcement (cap total context)
 * 5. Confidence assessment
 *
 * Reference: Claude Code uses full conversation + explicit files.
 * We use search + ranking since our source is a wiki, not a codebase.
 */

import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import { rankArticles, extractSections, getMatchContext, type ScoredArticle, type ArticleSection } from './relevanceRanker.js';
import { estimateTokens } from './tokenCounter.js';
import type { WikiArticle } from '../types.js';

export interface BuiltContext {
  /** Formatted context string to send to LLM */
  context: string;
  /** Articles used (for citations) */
  articlesUsed: ScoredArticle[];
  /** Total tokens used by context */
  tokenCount: number;
  /** Confidence in coverage */
  confidence: 'high' | 'medium' | 'low';
  /** Topics the wiki doesn't cover well */
  gaps: string[];
}

/** Max tokens to spend on article context */
const DEFAULT_ARTICLE_BUDGET = 50000;
/** Max tokens per individual article */
const MAX_TOKENS_PER_ARTICLE = 8000;
/** Min articles to include even if budget is tight */
const MIN_ARTICLES = 2;
/** Max articles to consider */
const MAX_ARTICLES = 15;

export class ContextBuilder {
  private fs: FilesystemStorage;
  private db: SQLiteStorage;

  constructor(dataDir: string) {
    this.fs = new FilesystemStorage(dataDir);
    this.db = new SQLiteStorage(dataDir);
  }

  /**
   * Build optimal context for a query.
   */
  build(
    query: string,
    options?: {
      articleBudget?: number;
      excludeSlugs?: Set<string>;  // For follow-up: exclude already-shown articles
    }
  ): BuiltContext {
    try {
      const budget = options?.articleBudget ?? DEFAULT_ARTICLE_BUDGET;
      const excludeSlugs = options?.excludeSlugs ?? new Set<string>();

      // 1. Get candidate articles via FTS
      const candidates = this.getCandidates(query);

      // 2. Filter out excluded slugs (for follow-up queries)
      const filtered = candidates.filter(a => !excludeSlugs.has(a.slug));

      if (filtered.length === 0) {
        return {
          context: 'No relevant articles found in your browzy. Try adding sources with /add.',
          articlesUsed: [],
          tokenCount: 0,
          confidence: 'low',
          gaps: [query],
        };
      }

      // 3. Rank by relevance
      const ranked = rankArticles(filtered, query, MAX_ARTICLES);

      // 4. Build context within budget
      const { context, used, totalTokens } = this.assembleContext(ranked, query, budget);

      // 5. Assess confidence
      const confidence = this.assessConfidence(ranked, query);
      const gaps = this.identifyGaps(ranked, query);

      return {
        context,
        articlesUsed: used,
        tokenCount: totalTokens,
        confidence,
        gaps,
      };
    } finally {
      try { this.db.close(); } catch { /* ignore close errors */ }
    }
  }

  /**
   * Get candidate articles from FTS and index.
   */
  private getCandidates(query: string): WikiArticle[] {
    const slugs = new Set<string>();
    const articles: WikiArticle[] = [];

    // FTS search
    try {
      const results = this.db.search(query, 20);
      for (const r of results) {
        if (!slugs.has(r.slug)) {
          slugs.add(r.slug);
          const article = this.fs.readArticle(r.slug);
          if (article) articles.push(article);
        }
      }
    } catch { /* FTS error */ }

    // If few FTS results, add from index
    if (articles.length < 5) {
      const index = this.fs.readIndex();
      if (index) {
        for (const entry of index.articles) {
          if (!slugs.has(entry.slug) && articles.length < 20) {
            slugs.add(entry.slug);
            const article = this.fs.readArticle(entry.slug);
            if (article) articles.push(article);
          }
        }
      }
    }

    return articles;
  }

  /**
   * Assemble context string from ranked articles within budget.
   * Uses section-level chunking: only include relevant sections.
   */
  private assembleContext(
    ranked: ScoredArticle[],
    query: string,
    budget: number,
  ): { context: string; used: ScoredArticle[]; totalTokens: number } {
    const sections: string[] = [];
    const used: ScoredArticle[] = [];
    let totalTokens = 0;

    for (const scored of ranked) {
      if (used.length >= MAX_ARTICLES) break;
      if (totalTokens >= budget && used.length >= MIN_ARTICLES) break;

      const article = scored.article;
      const fm = article.frontmatter;

      // Build article context — use relevant sections if available
      let articleContent: string;

      // Only call extractSections if matchedSections don't already cover the article
      const allSections = scored.matchedSections.length > 0 ? scored.matchedSections : extractSections(article.content);
      if (scored.matchedSections.length > 0 && scored.matchedSections.length < allSections.length) {
        // Include only relevant sections (+ intro always)
        const sectionTexts = scored.matchedSections
          .slice(0, 5) // Max 5 sections per article
          .map(s => s.header === '(intro)' ? s.content : `### ${s.header}\n${s.content}`);
        articleContent = sectionTexts.join('\n\n');
      } else {
        articleContent = article.content;
      }

      // Section-level chunking: when article exceeds per-article budget,
      // include only the most relevant complete sections instead of hard-cutting.
      if (estimateTokens(articleContent) > MAX_TOKENS_PER_ARTICLE) {
        // Use already-scored matchedSections when available; otherwise extract fresh
        let articleSections: ArticleSection[];
        if (scored.matchedSections.length > 0) {
          articleSections = scored.matchedSections;
        } else {
          articleSections = allSections;
        }

        let selectedContent = '';
        let usedTokens = 0;

        // Always include intro section first
        const intro = articleSections.find(s => s.header === '(intro)');
        if (intro) {
          const introText = intro.content.trim();
          if (introText.length > 0) {
            selectedContent += introText + '\n\n';
            usedTokens += estimateTokens(introText);
          }
        }

        // Add remaining sections in descending relevance order
        const remaining = articleSections
          .filter(s => s !== intro)
          .sort((a, b) => b.relevanceScore - a.relevanceScore);

        let includedCount = intro ? 1 : 0;

        for (const section of remaining) {
          const sectionText = `## ${section.header}\n${section.content.trim()}`;
          const sectionTokens = estimateTokens(sectionText);
          if (usedTokens + sectionTokens > MAX_TOKENS_PER_ARTICLE) continue;

          selectedContent += sectionText + '\n\n';
          usedTokens += sectionTokens;
          includedCount++;
        }

        articleContent = selectedContent.trim();

        // Indicate omitted sections
        if (includedCount < articleSections.length) {
          articleContent += '\n\n[...some sections omitted for relevance]';
        }
      }

      const articleBlock = [
        `### [[${article.slug}]] — ${fm.title}`,
        `Tags: ${(fm.tags || []).join(', ')}`,
        `Sources: ${(fm.sources || []).join(', ')}`,
        '',
        articleContent,
      ].join('\n');

      const blockTokens = estimateTokens(articleBlock);

      if (totalTokens + blockTokens > budget && used.length >= MIN_ARTICLES) {
        break; // Budget exceeded
      }

      sections.push(articleBlock);
      used.push(scored);
      totalTokens += blockTokens;
    }

    const header = `KNOWLEDGE BASE CONTEXT (${used.length} article${used.length !== 1 ? 's' : ''}, ${Math.round(totalTokens / 1000)}K tokens):\n`;
    const context = header + '\n' + sections.join('\n\n---\n\n');

    return { context, used, totalTokens };
  }

  /**
   * Assess confidence in the wiki's coverage of this query.
   */
  private assessConfidence(ranked: ScoredArticle[], query: string): 'high' | 'medium' | 'low' {
    if (ranked.length === 0) return 'low';

    const topScore = ranked[0].score;
    const avgScore = ranked.reduce((sum, r) => sum + r.score, 0) / ranked.length;

    // High: strong top match + multiple supporting articles
    if (topScore > 15 && ranked.length >= 3 && avgScore > 5) return 'high';
    // Medium: decent match or few supporting articles
    if (topScore > 5 || (ranked.length >= 2 && avgScore > 2)) return 'medium';
    // Low: weak matches
    return 'low';
  }

  /**
   * Identify gaps — what the wiki doesn't cover well.
   * Uses per-term FTS5 queries against the full corpus so that terms
   * appearing anywhere in article body text (not just titles/tags) are
   * recognized as covered.  Porter stemming in FTS5 handles variants
   * like "running" matching "run" automatically.
   */
  private identifyGaps(_ranked: ScoredArticle[], query: string): string[] {
    const STOP_WORDS = new Set([
      // Articles, prepositions, conjunctions
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at',
      'to', 'for', 'of', 'and', 'or', 'but', 'not', 'with', 'this',
      'that', 'it', 'from', 'by', 'as', 'be', 'has', 'had', 'have',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'what',
      'how', 'why', 'when', 'where', 'who', 'which', 'can', 'me', 'my',
      'i', 'you', 'your', 'we', 'they', 'them', 'about',
      // Greetings and conversational filler — NEVER knowledge gaps
      'hello', 'hi', 'hey', 'thanks', 'thank', 'please', 'okay', 'yes',
      'no', 'sure', 'well', 'just', 'like', 'know', 'think', 'want',
      'need', 'tell', 'show', 'help', 'give', 'make', 'good', 'great',
      'much', 'many', 'some', 'more', 'also', 'very', 'really', 'here',
      'there', 'then', 'than', 'been', 'being', 'into', 'over', 'each',
      'between', 'after', 'before', 'other', 'such', 'only', 'same',
    ]);

    const terms = query.toLowerCase().split(/\s+/)
      .map(t => t.replace(/[^a-z0-9-]/g, '')) // strip punctuation
      .filter(t => t.length > 4 && !STOP_WORDS.has(t)); // min 5 chars (was 3)

    const gaps: string[] = [];
    for (const term of terms) {
      // FTS5 search across the full corpus (title, summary, content, tags).
      // A single result is enough to confirm the term is covered.
      const results = this.db.search(term, 1);
      if (results.length === 0) {
        gaps.push(term);
      }
    }

    return gaps;
  }
}
