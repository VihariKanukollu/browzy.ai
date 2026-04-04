import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import type { WikiArticle, WikiIndex, SearchResult } from '../types.js';

/**
 * Wiki manager — high-level CRUD and search over the wiki.
 */
export class Wiki {
  private fs: FilesystemStorage;
  private db: SQLiteStorage;

  constructor(dataDir: string) {
    this.fs = new FilesystemStorage(dataDir);
    this.db = new SQLiteStorage(dataDir);
  }

  getArticle(slug: string): WikiArticle | null {
    return this.fs.readArticle(slug);
  }

  listArticles(): WikiArticle[] {
    return this.fs.listArticles();
  }

  getIndex(): WikiIndex | null {
    return this.fs.readIndex();
  }

  search(query: string, limit = 10): SearchResult[] {
    return this.db.search(query, limit);
  }

  stats(): { articles: number; concepts: number; sources: number } {
    const index = this.fs.readIndex();
    const manifest = this.fs.getRawManifest();
    return {
      articles: index?.articles.length ?? 0,
      concepts: index?.concepts.length ?? 0,
      sources: manifest.length,
    };
  }

  close(): void {
    this.db.close();
  }
}
