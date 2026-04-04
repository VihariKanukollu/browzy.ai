import { copyFileSync } from 'fs';
import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Create schema_version table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY NOT NULL DEFAULT 0
        );
        INSERT OR REPLACE INTO schema_version (version) VALUES (1);
      `);
    },
  },
  {
    version: 2,
    description: 'Recreate articles_fts with porter tokenizer',
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS articles_fts;
        CREATE VIRTUAL TABLE articles_fts USING fts5(
          slug UNINDEXED,
          title,
          summary,
          content,
          tags,
          tokenize='porter unicode61'
        );
        INSERT INTO articles_fts (slug, title, summary, content, tags)
          SELECT slug, title, summary, content, tags FROM articles;
      `);
    },
  },
];

export function runMigrations(db: Database.Database, dbPath: string): void {
  let currentVersion = 0;

  const hasVersionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();

  if (hasVersionTable) {
    const row = db
      .prepare('SELECT version FROM schema_version')
      .get() as { version: number } | undefined;
    if (row) {
      currentVersion = row.version;
    }
  }

  if (migrations.length === 0) return;

  const maxVersion = migrations[migrations.length - 1].version;
  if (currentVersion >= maxVersion) return;

  const pending = migrations.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    // Backup before destructive migrations (version 2+)
    if (migration.version >= 2) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${dbPath}.bak-${timestamp}`;
      copyFileSync(dbPath, backupPath);
    }

    const runInTransaction = db.transaction(() => {
      migration.up(db);

      // Update or insert schema_version
      const exists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
        )
        .get();
      if (exists) {
        // Clear and re-insert to avoid stale rows (schema_version uses version as PK)
        db.prepare('DELETE FROM schema_version').run();
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
          migration.version,
        );
      }
    });

    try {
      runInTransaction();
    } catch (err) {
      throw new Error(
        `Migration ${migration.version} (${migration.description}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
