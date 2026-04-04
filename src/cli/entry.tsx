#!/usr/bin/env node

import dotenv from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';

// Load .env from ~/.browzy/.env first (global), then cwd/.env (local override)
dotenv.config({ path: join(homedir(), '.browzy', '.env') });
dotenv.config(); // cwd/.env — won't overwrite already-set vars

import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { BrowzyApp, BrowzyErrorBoundary } from './app.js';
import { needsOnboarding, runOnboarding } from './onboarding.js';

import { initCommand } from './commands/init.js';
import { ingestCommand } from './commands/ingest.js';
import { compileCommand } from './commands/compile.js';
import { queryCommand } from './commands/query.js';
import { lintCommand } from './commands/lint.js';
import { statusCommand } from './commands/status.js';
import { searchCommand } from './commands/search.js';

// Prevent corepack issues
process.env.COREPACK_ENABLE_AUTO_PIN = '0';

// Signal handlers for graceful shutdown
process.on('SIGTERM', () => process.exit(143));
process.on('SIGHUP', () => process.exit(129));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

async function main() {
  if (process.argv.length <= 2) {
    if (needsOnboarding()) {
      const success = await runOnboarding();
      if (!success) process.exit(0);
    }

    try {
      const { waitUntilExit } = render(
        React.createElement(BrowzyErrorBoundary, null,
          React.createElement(BrowzyApp)
        ),
        { exitOnCtrlC: false }
      );

      await waitUntilExit();
    } catch (err) {
      // Ensure terminal is restored even on crash
      process.stdout.write('\x1B[?25h'); // Show cursor
      console.error('browzy error:', err);
      process.exit(1);
    }
    return;
  }

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

  program.parse();
}

main().catch(err => {
  process.stdout.write('\x1B[?25h'); // Show cursor
  console.error(err);
  process.exit(1);
});
