import { Command } from 'commander';
import chalk from 'chalk';
import { Wiki } from '../../core/wiki/index.js';
import { getConfig, ensureDirs, info, error } from '../helpers.js';

export const searchCommand = new Command('search')
  .description('Search the knowledge base')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', '10')
  .action(async (query: string, opts) => {
    try {
      const config = getConfig();
      ensureDirs(config);

      const wiki = new Wiki(config.dataDir);
      const results = wiki.search(query, parseInt(opts.limit));

      if (results.length === 0) {
        info('No results found');
        wiki.close();
        return;
      }

      console.log();
      for (const r of results) {
        console.log(`${chalk.cyan(r.slug)} ${chalk.dim(`(${r.score.toFixed(1)})`)}`);
        console.log(`  ${chalk.bold(r.title)}`);
        console.log(`  ${chalk.dim(r.snippet)}`);
        console.log();
      }

      wiki.close();
    } catch (err: any) {
      error(`Search failed: ${err.message}`);
      process.exit(1);
    }
  });
