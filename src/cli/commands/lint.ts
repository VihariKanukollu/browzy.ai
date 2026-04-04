import { Command } from 'commander';
import chalk from 'chalk';
import { WikiLinter } from '../../core/lint/index.js';
import { getConfigAndLLM, ensureDirs, spinner, success, info, error } from '../helpers.js';

export const lintCommand = new Command('lint')
  .description('Run health checks on the wiki')
  .action(async () => {
    const spin = spinner('Linting wiki...');
    spin.start();

    try {
      const { config, llm } = getConfigAndLLM();
      ensureDirs(config);

      const linter = new WikiLinter(config.dataDir, llm);
      const issues = await linter.lint();

      spin.stop();

      if (issues.length === 0) {
        success('Wiki is healthy — no issues found');
        return;
      }

      const errors = issues.filter(i => i.severity === 'error');
      const warnings = issues.filter(i => i.severity === 'warning');
      const suggestions = issues.filter(i => i.severity === 'suggestion');

      for (const issue of issues) {
        const icon =
          issue.severity === 'error' ? chalk.red('✗') :
          issue.severity === 'warning' ? chalk.yellow('⚠') :
          chalk.blue('💡');

        console.log(`${icon} [${issue.article}] ${issue.message}`);
        if (issue.suggestion) {
          console.log(`  → ${chalk.dim(issue.suggestion)}`);
        }
      }

      console.log();
      info(`${errors.length} errors, ${warnings.length} warnings, ${suggestions.length} suggestions`);
    } catch (err: any) {
      spin.stop();
      error(`Lint failed: ${err.message}`);
      process.exit(1);
    }
  });
