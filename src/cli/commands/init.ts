import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { success, info, error } from '../helpers.js';

export const initCommand = new Command('init')
  .description('Initialize a new browzy knowledge base')
  .option('-d, --dir <path>', 'Data directory path', join(homedir(), '.browzy', 'default'))
  .option('-p, --provider <provider>', 'LLM provider (claude or openai)', 'claude')
  .action(async (opts) => {
    const dataDir = opts.dir;
    const provider = opts.provider;

    // Create data directories
    const dirs = [
      dataDir,
      join(dataDir, 'raw'),
      join(dataDir, 'raw', 'images'),
      join(dataDir, 'wiki'),
      join(dataDir, 'output'),
      join(dataDir, '.browzy'),
    ];

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    // Write config file
    const configPath = join(process.cwd(), 'browzy.config.json');
    if (!existsSync(configPath)) {
      const config = {
        dataDir,
        llm: {
          provider,
          model: provider === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-4o',
        },
        compile: {
          batchSize: 20,
          extractConcepts: true,
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      success(`Created config: ${configPath}`);
    } else {
      info('Config already exists, skipping');
    }

    success(`Knowledge base initialized at: ${dataDir}`);
    info(`Set your API key: export ${provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}=...`);
    info('Start ingesting: browzy ingest <url-or-file>');
  });
