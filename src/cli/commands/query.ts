import { Command } from 'commander';
import { QueryEngine } from '../../core/query/index.js';
import type { OutputFormat } from '../../core/query/index.js';
import { getConfigAndLLM, ensureDirs, spinner, success, info, error } from '../helpers.js';

export const queryCommand = new Command('query')
  .description('Ask a question against the knowledge base')
  .argument('<question>', 'Your question')
  .option('-f, --format <format>', 'Output format (markdown, marp, json)', 'markdown')
  .option('-s, --save', 'Save output to a file')
  .action(async (question: string, opts) => {
    const spin = spinner('Researching...');
    spin.start();

    try {
      const { config, llm } = getConfigAndLLM();
      ensureDirs(config);

      const engine = new QueryEngine(config.dataDir, llm);
      const result = await engine.query(question, {
        format: opts.format as OutputFormat,
        save: opts.save,
      });

      spin.stop();
      console.log();
      console.log(result.answer);
      console.log();

      if (result.sourcesUsed.length > 0) {
        info(`Sources: ${result.sourcesUsed.join(', ')}`);
      }
      if (result.outputPath) {
        success(`Saved to: ${result.outputPath}`);
      }
    } catch (err: any) {
      spin.stop();
      error(`Query failed: ${err.message}`);
      process.exit(1);
    }
  });
