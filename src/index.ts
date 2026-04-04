// browzy.ai — LLM-powered personal knowledge base engine
// This is the library entry point for programmatic use.

export {
  loadConfig,
  ensureDataDirs,
  createProvider,
  ingest,
  detectSourceType,
  WikiCompiler,
  QueryEngine,
  WikiLinter,
  Wiki,
  FilesystemStorage,
  SQLiteStorage,
} from './core/index.js';

export type * from './core/types.js';
