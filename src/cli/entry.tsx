#!/usr/bin/env node

import dotenv from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';

// Load .env: cwd/.env first (local project config), then ~/.browzy/.env (global fallback).
// dotenv.config() won't overwrite already-set vars, so local takes precedence.
dotenv.config(); // cwd/.env — local project config loaded first
dotenv.config({ path: join(homedir(), '.browzy', '.env') }); // global fallback

import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { BrowzyApp, BrowzyErrorBoundary } from './app.js';
// onboarding is deferred — only imported when explicitly requested via /setup
// import { needsOnboarding, runOnboarding } from './onboarding.js';

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
    // Onboarding is now deferred — the app seeds demo articles and prompts
    // for an API key inline when the user first needs the LLM.
    // The old wizard (runOnboarding) is kept for explicit /setup but never auto-runs.

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
