/**
 * Relevance ranking for articles.
 *
 * Scores articles against a query using multiple signals:
 * - Keyword match density (TF-IDF inspired)
 * - Title match boost
 * - Tag match boost
 * - Recency (newer articles ranked higher)
 * - Backlink count (more connected = more authoritative)
 * - Section-level relevance (which parts of the article matter)
 *
 * Reference: Claude Code uses message recency + explicit file declarations.
 * We go further with multi-signal scoring since our use case is search-heavy.
 */

import type { WikiArticle } from '../types.js';

export interface ScoredArticle {
  article: WikiArticle;
  score: number;
  matchedSections: ArticleSection[];
  signals: {
    keywordDensity: number;
    titleMatch: number;
    tagMatch: number;
    recency: number;
    authority: number;
  };
}

export interface ArticleSection {
  header: string;
  content: string;
  relevanceScore: number;
}

/**
 * Extract sections from an article by splitting on headers.
 */
export function extractSections(content: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  const lines = content.split('\n');
  let currentHeader = '(intro)';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch && headerMatch[1]) {
      if (currentLines.length > 0) {
        sections.push({
          header: currentHeader,
          content: currentLines.join('\n'),
          relevanceScore: 0,
        });
      }
      currentHeader = headerMatch[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      header: currentHeader,
      content: currentLines.join('\n'),
      relevanceScore: 0,
    });
  }

  return sections;
}

/**
 * Score a section's relevance to query terms.
 */
function scoreSectionRelevance(section: ArticleSection, queryTerms: string[]): number {
  const lower = (section.header + ' ' + section.content).toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    const termLower = term.toLowerCase();
    // Count occurrences
    let idx = 0;
    let count = 0;
    while ((idx = lower.indexOf(termLower, idx)) !== -1) {
      count++;
      idx += termLower.length;
    }

    if (count > 0) {
      // TF: diminishing returns after first few matches
      score += Math.log2(1 + count);
      // Header match is worth 3x
      if (section.header.toLowerCase().includes(termLower)) {
        score += 3;
      }
    }
  }

  // Normalize by section length (prefer dense matches)
  const wordCount = lower.split(/\s+/).length;
  if (wordCount > 0) {
    score = score / Math.log2(1 + wordCount) * 10;
  }

  return score;
}

/**
 * Rank articles by relevance to a query.
 */
export function rankArticles(
  articles: WikiArticle[],
  query: string,
  limit = 10,
): ScoredArticle[] {
  // Extract query terms (remove stop words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'not', 'with', 'this', 'that', 'it', 'from', 'by', 'as', 'be', 'has', 'had', 'have', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'me', 'my', 'i', 'you', 'your', 'we', 'they', 'them', 'about']);
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !stopWords.has(t));

  if (queryTerms.length === 0) {
    // No meaningful terms — return by recency
    return articles
      .slice(0, limit)
      .map(a => ({
        article: a,
        score: 0,
        matchedSections: extractSections(a.content),
        signals: { keywordDensity: 0, titleMatch: 0, tagMatch: 0, recency: 0, authority: 0 },
      }));
  }

  const now = Date.now();
  const scored: ScoredArticle[] = [];

  for (const article of articles) {
    const fullText = (article.frontmatter.title + ' ' + article.frontmatter.summary + ' ' + article.content).toLowerCase();

    // 1. Keyword density
    let keywordDensity = 0;
    for (const term of queryTerms) {
      let idx = 0;
      let count = 0;
      while ((idx = fullText.indexOf(term, idx)) !== -1) {
        count++;
        idx += term.length;
      }
      keywordDensity += Math.log2(1 + count);
    }

    // 2. Title match (huge boost)
    let titleMatch = 0;
    const titleLower = article.frontmatter.title.toLowerCase();
    for (const term of queryTerms) {
      if (titleLower.includes(term)) titleMatch += 5;
    }
    // Exact title match
    if (queryTerms.some(t => titleLower === t || article.slug.includes(t))) {
      titleMatch += 10;
    }

    // 3. Tag match
    let tagMatch = 0;
    const tags = (article.frontmatter.tags || []).map(t => t.toLowerCase());
    for (const term of queryTerms) {
      if (tags.some(tag => tag.includes(term))) tagMatch += 3;
    }

    // 4. Recency (articles updated recently score higher)
    const updatedAt = new Date(article.frontmatter.updated || article.frontmatter.created || '2020-01-01').getTime();
    const ageMs = Math.max(0, now - (isNaN(updatedAt) ? 0 : updatedAt));
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recency = Math.max(0, 5 - ageDays * 0.1);

    // 5. Authority (backlink count)
    const authority = Math.min(5, (article.frontmatter.backlinks || []).length);

    // Total score
    const score = keywordDensity + titleMatch + tagMatch + recency + authority;

    // Score sections
    const sections = extractSections(article.content);
    for (const section of sections) {
      section.relevanceScore = scoreSectionRelevance(section, queryTerms);
    }

    // Keep only relevant sections (score > 0), sorted by relevance
    const matchedSections = sections
      .filter(s => s.relevanceScore > 0 || s.header === '(intro)')
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (score > 0) {
      scored.push({
        article,
        score,
        matchedSections,
        signals: { keywordDensity, titleMatch, tagMatch, recency, authority },
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get context lines around a match in article content.
 */
export function getMatchContext(content: string, query: string, contextLines = 2): string[] {
  const lines = content.split('\n');
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const matchedLineIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (queryTerms.some(term => lower.includes(term))) {
      // Add this line and surrounding context
      for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
        matchedLineIndices.add(j);
      }
    }
  }

  if (matchedLineIndices.size === 0) return [];

  const sorted = Array.from(matchedLineIndices).sort((a, b) => a - b);
  const result: string[] = [];
  let lastIdx = -2;

  for (const idx of sorted) {
    if (idx > lastIdx + 1) {
      result.push('...');
    }
    result.push(lines[idx]);
    lastIdx = idx;
  }

  return result;
}
