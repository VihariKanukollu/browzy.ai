import { Command } from 'commander';
import chalk from 'chalk';
import { Wiki } from '../../core/wiki/index.js';
import { getConfig, ensureDirs, info } from '../helpers.js';

export const statusCommand = new Command('status')
  .description('Show knowledge base status')
  .action(async () => {
    try {
      const config = getConfig();
      ensureDirs(config);

      const wiki = new Wiki(config.dataDir);
      const stats = wiki.stats();

      console.log();
      console.log(chalk.bold('browzy knowledge base'));
      console.log(chalk.dim(`Data: ${config.dataDir}`));
      console.log(chalk.dim(`LLM: ${config.llm.provider} (${config.llm.model || 'default'})`));
      console.log();
      console.log(`  Sources:  ${chalk.cyan(stats.sources)}`);
      console.log(`  Articles: ${chalk.cyan(stats.articles)}`);
      console.log(`  Concepts: ${chalk.cyan(stats.concepts)}`);
      console.log();

      wiki.close();
    } catch (err: any) {
      info(`No knowledge base found. Run: browzy init`);
    }
  });
