import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { Wiki } from '../core/wiki/wiki.js';

// Brand color: #6C3BAA (purple)
const p = chalk.hex('#6C3BAA');
const pb = chalk.hex('#6C3BAA').bold;
const pl = chalk.hex('#9B6ED8');  // lighter purple
const dim = chalk.hex('#7A7A8C');
const accent = chalk.hex('#C084FC');
const bright = chalk.white.bold;

const LOGO = `
  ${pb('██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗██╗   ██╗')}
  ${pb('██╔══██╗██╔══██╗██╔═══██╗██║    ██║╚══███╔╝╚██╗ ██╔╝')}
  ${pb('██████╔╝██████╔╝██║   ██║██║ █╗ ██║  ███╔╝  ╚████╔╝')}
  ${pl('██╔══██╗██╔══██╗██║   ██║██║███╗██║ ███╔╝    ╚██╔╝')}
  ${pl('██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████╗   ██║')}
  ${pl('╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝   ╚═╝')}
`;

export function showBanner(): void {
  console.log(LOGO);
  console.log(dim('  LLM-powered knowledge base engine') + dim('                        v0.1.0'));
  console.log();

  try {
    const config = loadConfig();
    const wiki = new Wiki(config.dataDir);
    const stats = wiki.stats();
    wiki.close();

    const provider = config.llm.provider;
    const model = config.llm.model || 'default';

    console.log(p('  ─────────────────────────────────────────────────────'));
    console.log();
    console.log(`  ${dim('sources')}  ${bright(String(stats.sources).padStart(4))}    ${dim('articles')}  ${bright(String(stats.articles).padStart(4))}    ${dim('concepts')}  ${bright(String(stats.concepts).padStart(4))}`);
    console.log(`  ${dim('provider')} ${chalk.white(provider.padStart(4))}    ${dim('model')}     ${chalk.white(model)}`);
    console.log(`  ${dim('data')}     ${chalk.white(config.dataDir)}`);
  } catch {
    console.log(dim('  No knowledge base found.'));
    console.log(`  Run ${accent('browzy init')} to get started.`);
  }

  console.log();
  console.log(p('  ─────────────────────────────────────────────────────'));
  console.log();
  console.log(`  ${dim('Just type a question, or use / commands:')}`);
  console.log();
  console.log(`  ${accent('/add <sources...>')}     ${dim('Add URLs, PDFs, images, text files')}`);
  console.log(`  ${accent('/ask <question>')}       ${dim('Search + ask your knowledge base')}`);
  console.log(`  ${accent('/health')}              ${dim('Stats, checks & suggestions')}`);
  console.log(`  ${accent('/rebuild')}             ${dim('Force recompile wiki')}`);
  console.log(`  ${accent('/help')}                ${dim('All commands')}`);
  console.log();
}
