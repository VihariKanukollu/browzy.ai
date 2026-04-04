import { Command } from 'commander';
import { ingest } from '../../core/ingest/index.js';
import { getConfig, getConfigAndLLM, ensureDirs, spinner, success, error } from '../helpers.js';
import type { SourceType } from '../../core/types.js';

export const ingestCommand = new Command('ingest')
  .description('Ingest a source into the knowledge base')
  .argument('<source>', 'URL or file path to ingest')
  .option('-t, --type <type>', 'Source type (web, pdf, image, text, markdown)')
  .action(async (source: string, opts) => {
    const spin = spinner(`Ingesting: ${source}`);
    spin.start();

    try {
      const { config, llm } = getConfigAndLLM();
      ensureDirs(config);

      const result = await ingest(source, config.dataDir, {
        llm,
        type: opts.type as SourceType | undefined,
      });

      spin.stop();
      success(`Ingested: ${result.title}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  ID: ${result.id}`);
      console.log(`  Path: ${result.path}`);
      if (result.images.length > 0) {
        console.log(`  Images: ${result.images.length}`);
      }
    } catch (err: any) {
      spin.stop();
      error(`Failed to ingest: ${err.message}`);
      process.exit(1);
    }
  });
