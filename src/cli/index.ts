#!/usr/bin/env node

import dotenv from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';

// Load .env from ~/.browzy/.env first (global), then cwd/.env (local override)
dotenv.config({ path: join(homedir(), '.browzy', '.env') });
dotenv.config(); // cwd/.env — won't overwrite already-set vars
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { ingestCommand } from './commands/ingest.js';
import { compileCommand } from './commands/compile.js';
import { queryCommand } from './commands/query.js';
import { lintCommand } from './commands/lint.js';
import { statusCommand } from './commands/status.js';
import { searchCommand } from './commands/search.js';
import { showBanner } from './banner.js';
import { BrowzyRepl } from './repl.js';
import { needsOnboarding, runOnboarding } from './onboarding.js';

const program = new Command();

program
  .name('browzy')
  .description('LLM-powered personal knowledge base engine')
  .version('1.0.0');

program.addCommand(initCommand);
program.addCommand(ingestCommand);
program.addCommand(compileCommand);
program.addCommand(queryCommand);
program.addCommand(lintCommand);
program.addCommand(statusCommand);
program.addCommand(searchCommand);

// No args → interactive mode
if (process.argv.length <= 2) {
  (async () => {
    if (needsOnboarding()) {
      const success = await runOnboarding();
      if (!success) process.exit(0);
    }
    showBanner();
    const repl = new BrowzyRepl();
    repl.start();
  })();
} else {
  program.parse();
}
