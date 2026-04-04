import { Command } from 'commander';
import { WikiCompiler } from '../../core/compile/index.js';
import { getConfigAndLLM, ensureDirs, spinner, success, info, error } from '../helpers.js';

export const compileCommand = new Command('compile')
  .description('Compile raw sources into wiki articles')
  .option('-b, --batch-size <n>', 'Max sources to process', '20')
  .option('--no-concepts', 'Skip concept extraction')
  .action(async (opts) => {
    const spin = spinner('Compiling wiki...');
    spin.start();

    try {
      const { config, llm } = getConfigAndLLM();
      ensureDirs(config);

      const compiler = new WikiCompiler(config.dataDir, llm);
      const result = await compiler.compile({
        batchSize: parseInt(opts.batchSize),
        extractConcepts: opts.concepts !== false,
      });

      spin.stop();

      if (result.articlesCreated.length > 0) {
        success(`Created ${result.articlesCreated.length} articles:`);
        result.articlesCreated.forEach(s => console.log(`  + ${s}`));
      }
      if (result.articlesUpdated.length > 0) {
        success(`Updated ${result.articlesUpdated.length} articles:`);
        result.articlesUpdated.forEach(s => console.log(`  ~ ${s}`));
      }
      if (result.conceptsExtracted.length > 0) {
        info(`Suggested ${result.conceptsExtracted.length} new concepts:`);
        result.conceptsExtracted.forEach(s => console.log(`  ? ${s}`));
      }
      if (result.articlesCreated.length === 0 && result.articlesUpdated.length === 0) {
        info('Wiki is up to date — nothing to compile');
      }
    } catch (err: any) {
      spin.stop();
      error(`Compilation failed: ${err.message}`);
      process.exit(1);
    }
  });
