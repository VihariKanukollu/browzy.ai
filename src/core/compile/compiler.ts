import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import type { LLMProvider } from '../llm/provider.js';
import type { RawSource, WikiArticle, ArticleFrontmatter, WikiIndex } from '../types.js';

const SYSTEM_PROMPT = `You are a research wiki compiler. Your job is to synthesize raw source material into well-structured wiki articles.

Rules:
- Write in clear, concise, encyclopedic prose
- Include specific facts, data points, and quotes from sources
- Use markdown formatting (headers, lists, code blocks, links)
- Link to other articles using [[article-slug]] wiki-link syntax
- Cite sources using [source-id] notation
- Extract and name key concepts that deserve their own articles
- Be thorough but avoid redundancy`;

export interface CompileResult {
  articlesCreated: string[];
  articlesUpdated: string[];
  conceptsExtracted: string[];
}

export class WikiCompiler {
  private fs: FilesystemStorage;
  private db: SQLiteStorage;
  private llm: LLMProvider;

  constructor(dataDir: string, llm: LLMProvider) {
    this.fs = new FilesystemStorage(dataDir);
    this.db = new SQLiteStorage(dataDir);
    this.llm = llm;
  }

  /**
   * Run incremental compilation: process new/updated sources,
   * update affected articles, extract new concepts.
   */
  async compile(options?: { batchSize?: number; extractConcepts?: boolean }): Promise<CompileResult> {
    const batchSize = options?.batchSize ?? 20;
    const extractConcepts = options?.extractConcepts ?? true;

    const result: CompileResult = {
      articlesCreated: [],
      articlesUpdated: [],
      conceptsExtracted: [],
    };

    // 1. Get all raw sources and existing articles
    const sources = this.fs.getRawManifest();
    const existingArticles = this.fs.listArticles();
    const index = this.fs.readIndex();

    // 2. Find sources that haven't been compiled yet
    const compiledSourceIds = new Set(
      existingArticles.flatMap(a => a.frontmatter.sources || [])
    );
    const newSources = sources.filter(s => !compiledSourceIds.has(s.id));

    if (newSources.length === 0 && existingArticles.length > 0) {
      // Nothing new to compile — still update index
      await this.updateIndex(existingArticles);
      this.db.close();
      return result;
    }

    // 3. Process sources in batches
    const batch = newSources.slice(0, batchSize);

    for (const source of batch) {
      const rawContent = this.fs.readRawSource(
        source.path.split('/').pop()!
      );

      // Generate or update articles from this source
      const articles = await this.compileSource(source, rawContent, existingArticles);

      for (const article of articles) {
        const existing = existingArticles.find(a => a.slug === article.slug);
        if (existing) {
          result.articlesUpdated.push(article.slug);
        } else {
          result.articlesCreated.push(article.slug);
        }

        this.fs.writeArticle(article.slug, article.frontmatter, article.content);
        this.db.indexArticle({
          slug: article.slug,
          title: article.frontmatter.title,
          summary: article.frontmatter.summary,
          content: article.content,
          tags: article.frontmatter.tags,
          createdAt: article.frontmatter.created,
          updatedAt: article.frontmatter.updated,
        });
      }
    }

    // 4. Extract concepts if enabled
    if (extractConcepts && batch.length > 0) {
      const concepts = await this.extractConcepts(existingArticles);
      result.conceptsExtracted = concepts;
    }

    // 5. Update backlinks and index
    const allArticles = this.fs.listArticles();
    await this.updateBacklinks(allArticles);
    await this.updateIndex(allArticles);

    this.db.close();
    return result;
  }

  private async compileSource(
    source: RawSource,
    content: string,
    existingArticles: WikiArticle[]
  ): Promise<WikiArticle[]> {
    const existingIndex = existingArticles.map(a => `- ${a.slug}: ${a.frontmatter.title} — ${a.frontmatter.summary}`).join('\n');

    const prompt = `Compile the following raw source into wiki articles.

SOURCE ID: ${source.id}
SOURCE TITLE: ${source.title}
SOURCE TYPE: ${source.type}

EXISTING ARTICLES:
${existingIndex || '(none yet)'}

RAW CONTENT:
${content.slice(0, 15000)}

INSTRUCTIONS:
1. If this source's content fits into an existing article, output an UPDATED version of that article with the new information merged in.
2. If this source warrants a new article, create one.
3. You may output multiple articles if the source covers multiple distinct topics.
4. Use [[slug]] to link between articles.
5. Cite this source as [${source.id}].

OUTPUT FORMAT — output one or more articles in this exact format:

===ARTICLE===
SLUG: article-slug-here
TITLE: Article Title Here
TAGS: tag1, tag2, tag3
SUMMARY: One-sentence summary of the article.
---
Article content in markdown here...
===END===`;

    const response = await this.llm.chat(
      [{ role: 'user', content: prompt }],
      { system: SYSTEM_PROMPT, maxTokens: 8192 }
    );

    return this.parseArticles(response.content, source.id);
  }

  private parseArticles(llmOutput: string, sourceId: string): WikiArticle[] {
    const articles: WikiArticle[] = [];
    const blocks = llmOutput.split('===ARTICLE===').slice(1);

    for (const block of blocks) {
      const endIdx = block.indexOf('===END===');
      const content = endIdx >= 0 ? block.slice(0, endIdx) : block;

      const slugMatch = content.match(/SLUG:\s*(.+)/);
      const titleMatch = content.match(/TITLE:\s*(.+)/);
      const tagsMatch = content.match(/TAGS:\s*(.+)/);
      const summaryMatch = content.match(/SUMMARY:\s*(.+)/);
      const bodyMatch = content.match(/---\n([\s\S]*)/);

      if (!slugMatch || !titleMatch) continue;

      const slug = slugMatch[1].trim();
      const now = new Date().toISOString();

      const frontmatter: ArticleFrontmatter = {
        title: titleMatch[1].trim(),
        tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [],
        sources: [sourceId],
        backlinks: [],
        created: now,
        updated: now,
        summary: summaryMatch?.[1]?.trim() || '',
      };

      articles.push({
        slug,
        frontmatter,
        content: bodyMatch?.[1]?.trim() || '',
        path: '',
      });
    }

    return articles;
  }

  private async extractConcepts(existingArticles: WikiArticle[]): Promise<string[]> {
    if (existingArticles.length === 0) return [];

    const articleList = existingArticles
      .map(a => `- ${a.slug}: ${a.frontmatter.title} [${a.frontmatter.tags.join(', ')}]`)
      .join('\n');

    const prompt = `Given these existing wiki articles, suggest new concept articles that would improve the wiki's coverage and interconnectedness.

EXISTING ARTICLES:
${articleList}

Output a JSON array of objects with "slug", "title", and "reason" fields. Only suggest concepts that would genuinely connect multiple existing articles. Output 3-5 suggestions max.`;

    const response = await this.llm.chat(
      [{ role: 'user', content: prompt }],
      { system: SYSTEM_PROMPT, maxTokens: 2048 }
    );

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const concepts = JSON.parse(jsonMatch[0]) as Array<{ slug: string; title: string; reason: string }>;
      return concepts.map(c => c.slug);
    } catch {
      return [];
    }
  }

  private async updateBacklinks(articles: WikiArticle[]): Promise<void> {
    const linkMap = new Map<string, Set<string>>();

    for (const article of articles) {
      const wikiLinks = article.content.match(/\[\[([^\]]+)\]\]/g) || [];
      for (const link of wikiLinks) {
        const target = link.slice(2, -2).trim();
        if (!linkMap.has(target)) linkMap.set(target, new Set());
        linkMap.get(target)!.add(article.slug);
      }
    }

    for (const article of articles) {
      const backlinks = linkMap.get(article.slug);
      if (backlinks) {
        const newBacklinks = Array.from(backlinks);
        if (JSON.stringify(newBacklinks.sort()) !== JSON.stringify(article.frontmatter.backlinks.sort())) {
          article.frontmatter.backlinks = newBacklinks;
          this.fs.writeArticle(article.slug, article.frontmatter, article.content);
        }
      }
    }
  }

  private async updateIndex(articles: WikiArticle[]): Promise<void> {
    const conceptMap = new Map<string, string[]>();
    for (const article of articles) {
      for (const tag of article.frontmatter.tags) {
        if (!conceptMap.has(tag)) conceptMap.set(tag, []);
        conceptMap.get(tag)!.push(article.slug);
      }
    }

    const index: WikiIndex = {
      articles: articles.map(a => ({
        slug: a.slug,
        title: a.frontmatter.title,
        summary: a.frontmatter.summary,
        tags: a.frontmatter.tags,
      })),
      concepts: Array.from(conceptMap.entries()).map(([name, articleSlugs]) => ({
        name,
        articles: articleSlugs,
      })),
      lastCompiled: new Date().toISOString(),
    };

    this.fs.writeIndex(index);
  }
}
