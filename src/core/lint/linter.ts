import { FilesystemStorage } from '../storage/filesystem.js';
import type { LLMProvider } from '../llm/provider.js';
import type { WikiArticle, LintIssue, LintSeverity } from '../types.js';
import { LINTER_SYSTEM_PROMPT } from '../prompts.js';

export class WikiLinter {
  private fs: FilesystemStorage;
  private llm: LLMProvider;

  constructor(dataDir: string, llm: LLMProvider) {
    this.fs = new FilesystemStorage(dataDir);
    this.llm = llm;
  }

  /**
   * Run all lint checks on the wiki.
   */
  async lint(): Promise<LintIssue[]> {
    const articles = this.fs.listArticles();
    const issues: LintIssue[] = [];

    issues.push(...this.checkBrokenLinks(articles));
    issues.push(...this.checkOrphanArticles(articles));
    issues.push(...this.checkMissingFields(articles));
    issues.push(...await this.checkConsistency(articles));

    return issues;
  }

  /**
   * Check for [[wiki-links]] that point to non-existent articles.
   */
  private checkBrokenLinks(articles: WikiArticle[]): LintIssue[] {
    const slugs = new Set(articles.map(a => a.slug));
    const issues: LintIssue[] = [];

    for (const article of articles) {
      const links = article.content.match(/\[\[([^\]]+)\]\]/g) || [];
      for (const link of links) {
        const target = link.slice(2, -2).trim();
        if (!slugs.has(target)) {
          issues.push({
            severity: 'warning',
            article: article.slug,
            message: `Broken wiki link: [[${target}]]`,
            suggestion: `Create article "${target}" or fix the link`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Find articles with no incoming links (orphans).
   */
  private checkOrphanArticles(articles: WikiArticle[]): LintIssue[] {
    const linked = new Set<string>();
    for (const article of articles) {
      const links = article.content.match(/\[\[([^\]]+)\]\]/g) || [];
      for (const link of links) {
        linked.add(link.slice(2, -2).trim());
      }
    }

    return articles
      .filter(a => !linked.has(a.slug) && a.frontmatter.backlinks.length === 0)
      .map(a => ({
        severity: 'suggestion' as const,
        article: a.slug,
        message: 'Orphan article — no other articles link to this one',
        suggestion: 'Add links from related articles or merge into a broader article',
      }));
  }

  /**
   * Check for missing frontmatter fields.
   */
  private checkMissingFields(articles: WikiArticle[]): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const article of articles) {
      const fm = article.frontmatter;
      if (!fm.summary) {
        issues.push({
          severity: 'warning',
          article: article.slug,
          message: 'Missing summary in frontmatter',
        });
      }
      if (!fm.tags || fm.tags.length === 0) {
        issues.push({
          severity: 'warning',
          article: article.slug,
          message: 'No tags assigned',
        });
      }
      if (!fm.sources || fm.sources.length === 0) {
        issues.push({
          severity: 'suggestion',
          article: article.slug,
          message: 'No source references',
        });
      }
    }

    return issues;
  }

  /**
   * Use LLM to check for inconsistencies, duplicates, and gaps.
   */
  private async checkConsistency(articles: WikiArticle[]): Promise<LintIssue[]> {
    if (articles.length < 2) return [];

    const summaries = articles
      .map(a => `- ${a.slug}: ${a.frontmatter.title} — ${a.frontmatter.summary || '(no summary)'}`)
      .join('\n');

    const response = await this.llm.chat(
      [
        {
          role: 'user',
          content: `Review this wiki for issues. Check for:
1. Contradictory information between articles
2. Duplicate/overlapping articles that should be merged
3. Notable gaps in coverage
4. Inconsistent terminology

ARTICLES:
${summaries}

Output a JSON array of objects with "severity" (error/warning/suggestion), "article" (slug), "message", and optional "suggestion" fields. If no issues found, output [].`,
        },
      ],
      {
        system: LINTER_SYSTEM_PROMPT,
        maxTokens: 2048,
      }
    );

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];
      const validSeverities = new Set(['error', 'warning', 'suggestion']);
      return parsed
        .filter((item: unknown): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null &&
          typeof (item as Record<string, unknown>).severity === 'string' &&
          typeof (item as Record<string, unknown>).article === 'string' &&
          typeof (item as Record<string, unknown>).message === 'string' &&
          validSeverities.has((item as Record<string, unknown>).severity as string)
        )
        .map((item: Record<string, unknown>) => ({
          severity: item.severity as LintSeverity,
          article: String(item.article),
          message: String(item.message),
          suggestion: typeof item.suggestion === 'string' ? item.suggestion : undefined,
        }));
    } catch {
      return [];
    }
  }
}
