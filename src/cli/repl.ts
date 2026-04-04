import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, ensureDataDirs, createProvider } from '../core/index.js';
import { ingest } from '../core/ingest/index.js';
import { WikiCompiler } from '../core/compile/index.js';
import { QueryEngine } from '../core/query/index.js';
import { WikiLinter } from '../core/lint/index.js';
import { Wiki } from '../core/wiki/index.js';
import type { BrowzyConfig } from '../core/types.js';
import type { LLMProvider } from '../core/llm/provider.js';
import type { OutputFormat } from '../core/query/index.js';

const p = chalk.hex('#6C3BAA');
const accent = chalk.hex('#C084FC');
const dim = chalk.hex('#7A7A8C');

const SLASH_COMMANDS: Record<string, { description: string; usage?: string }> = {
  '/add':      { description: 'Add sources to your knowledge base (ingest + compile)', usage: '/add <urls or file paths...>' },
  '/ask':      { description: 'Ask a question or search the wiki', usage: '/ask <question>' },
  '/health':   { description: 'Wiki stats, health checks & suggestions' },
  '/rebuild':  { description: 'Force recompile entire wiki from sources' },
  '/format':   { description: 'Set output format', usage: '/format <markdown|marp|json>' },
  '/save':     { description: 'Toggle auto-save for outputs' },
  '/help':     { description: 'Show available commands' },
  '/quit':     { description: 'Exit browzy' },
};

export class BrowzyRepl {
  private rl!: readline.Interface;
  private config: BrowzyConfig;
  private llm: LLMProvider;
  private outputFormat: OutputFormat = 'markdown';
  private autoSave = false;

  constructor() {
    this.config = loadConfig();
    ensureDataDirs(this.config);
    this.llm = createProvider(this.config.llm);
  }

  start(): void {
    const separator = p('─'.repeat(process.stdout.columns || 60));
    console.log(separator);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: p('› '),
      completer: (line: string) => this.complete(line),
    });

    this.rl.prompt();

    const handleLine = async (line: string) => {
      const input = line.trim();
      if (!input) {
        this.rl.prompt();
        return;
      }

      this.rl.pause();

      try {
        const normalized = this.normalizeInput(input);

        if (normalized.startsWith('/')) {
          await this.handleSlashCommand(normalized);
        } else {
          // Bare text → ask (smart query)
          await this.cmdAsk(normalized);
        }
      } catch (err: any) {
        console.log(chalk.red('  error: ') + err.message);
      }

      this.rl.resume();
      this.rl.prompt();
    };

    this.rl.on('line', (line) => { handleLine(line); });

    this.rl.on('SIGINT', () => {
      console.log();
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log();
      console.log(dim('  Goodbye.'));
      process.exit(0);
    });
  }

  private normalizeInput(input: string): string {
    const stripped = input.replace(/^browzy\s+/i, '');
    const commandNames = ['add', 'ask', 'health', 'rebuild', 'format', 'save', 'help', 'quit', 'exit', 'q'];
    const firstWord = stripped.split(/\s+/)[0].toLowerCase();

    if (commandNames.includes(firstWord)) {
      const rest = stripped.slice(firstWord.length).trim();
      return rest ? `/${firstWord} ${rest}` : `/${firstWord}`;
    }

    if (input.startsWith('/')) return input;
    return input;
  }

  private complete(line: string): [string[], string] {
    if (line.startsWith('/')) {
      const matches = Object.keys(SLASH_COMMANDS).filter(c => c.startsWith(line));
      return [matches.length ? matches : Object.keys(SLASH_COMMANDS), line];
    }
    const bareCommands = Object.keys(SLASH_COMMANDS).map(c => c.slice(1));
    const matches = bareCommands.filter(c => c.startsWith(line));
    if (matches.length > 0) {
      return [matches, line];
    }
    return [[], line];
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/add':
        await this.cmdAdd(args);
        break;
      case '/ask':
        if (!args) {
          console.log(dim('  Type a question, or use: /ask <question>'));
        } else {
          await this.cmdAsk(args);
        }
        break;
      case '/health':
        await this.cmdHealth();
        break;
      case '/rebuild':
        await this.cmdRebuild();
        break;
      case '/format':
        this.cmdFormat(args);
        break;
      case '/save':
        this.autoSave = !this.autoSave;
        console.log(dim(`  Auto-save: ${this.autoSave ? chalk.green('on') : dim('off')}`));
        break;
      case '/help':
        this.cmdHelp();
        break;
      case '/quit':
      case '/exit':
      case '/q':
        this.rl.close();
        break;
      default:
        console.log(dim(`  Unknown command: ${cmd}. Type /help for available commands.`));
    }
  }

  // ── /add — ingest multiple sources + auto-compile ─────────────

  private async cmdAdd(args: string): Promise<void> {
    if (!args) {
      console.log(dim('  usage: /add <url or file path> [more urls/paths...]'));
      console.log(dim('  tip: drag & drop files into the terminal'));
      return;
    }

    // Parse multiple sources — split on whitespace but respect quoted paths
    const sources = this.parseMultipleSources(args);

    // Phase 1: Ingest all sources
    const spin = ora({ text: dim(`adding ${sources.length} source${sources.length > 1 ? 's' : ''}...`), color: 'white', spinner: 'dots' });
    spin.start();

    let ingested = 0;
    for (const source of sources) {
      try {
        spin.text = dim(`ingesting ${source.length > 50 ? source.slice(0, 47) + '...' : source} (${ingested + 1}/${sources.length})`);
        const result = await ingest(source, this.config.dataDir, { llm: this.llm });
        ingested++;
        spin.stop();
        console.log(chalk.green('  ✓ ') + result.title);
        console.log(dim(`    ${result.type} · ${result.id}${result.images.length > 0 ? ` · ${result.images.length} images` : ''}`));
        spin.start();
      } catch (err: any) {
        spin.stop();
        console.log(chalk.red('  ✗ ') + source);
        console.log(dim(`    ${err.message}`));
        spin.start();
      }
    }

    if (ingested === 0) {
      spin.stop();
      return;
    }

    // Phase 2: Auto-compile
    spin.text = dim('compiling into wiki...');
    spin.start();

    try {
      const compiler = new WikiCompiler(this.config.dataDir, this.llm);
      const result = await compiler.compile({
        batchSize: this.config.compile.batchSize,
        extractConcepts: this.config.compile.extractConcepts,
      });

      spin.stop();

      if (result.articlesCreated.length > 0) {
        console.log(chalk.green(`  ✓ created ${result.articlesCreated.length} articles: `) + result.articlesCreated.join(', '));
      }
      if (result.articlesUpdated.length > 0) {
        console.log(chalk.green(`  ✓ updated ${result.articlesUpdated.length} articles: `) + result.articlesUpdated.join(', '));
      }
      if (result.conceptsExtracted.length > 0) {
        console.log(dim(`  suggested concepts: ${result.conceptsExtracted.join(', ')}`));
      }
    } catch (err: any) {
      spin.stop();
      console.log(chalk.red('  compile error: ') + err.message);
    }

    console.log();
  }

  private parseMultipleSources(args: string): string[] {
    const sources: string[] = [];
    // Match quoted strings or unquoted non-space sequences
    const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
    let match;
    while ((match = regex.exec(args)) !== null) {
      sources.push(match[1] || match[2] || match[3]);
    }
    return sources;
  }

  // ── /ask — smart query (FTS + LLM) ───────────────────────────

  private async cmdAsk(question: string): Promise<void> {
    // First try quick FTS search
    const wiki = new Wiki(this.config.dataDir);
    const searchResults = wiki.search(question, 5);
    wiki.close();

    // If we got good FTS hits, show them as quick results first
    if (searchResults.length > 0) {
      console.log();
      console.log(dim('  quick matches:'));
      for (const r of searchResults.slice(0, 3)) {
        console.log(`  ${accent('→')} ${chalk.white.bold(r.title)} ${dim(`(${r.slug})`)}`);
      }
      console.log();
    }

    // Then do the full LLM-powered answer
    const spin = ora({ text: dim('thinking...'), color: 'white', spinner: 'dots' });
    spin.start();

    const engine = new QueryEngine(this.config.dataDir, this.llm);
    const result = await engine.query(question, {
      format: this.outputFormat,
      save: this.autoSave,
    });

    spin.stop();
    console.log();
    console.log(result.answer);
    console.log();

    if (result.sourcesUsed.length > 0) {
      console.log(dim(`  sources: ${result.sourcesUsed.join(', ')}`));
    }
    if (result.outputPath) {
      console.log(dim(`  saved: ${result.outputPath}`));
    }
    console.log();
  }

  // ── /health — status + lint combined ──────────────────────────

  private async cmdHealth(): Promise<void> {
    // Status first
    const wiki = new Wiki(this.config.dataDir);
    const stats = wiki.stats();
    wiki.close();

    console.log();
    console.log(`  ${dim('sources')} ${chalk.white.bold(String(stats.sources))}  ${p('·')}  ${dim('articles')} ${chalk.white.bold(String(stats.articles))}  ${p('·')}  ${dim('concepts')} ${chalk.white.bold(String(stats.concepts))}`);
    console.log(`  ${dim('format')}  ${chalk.white(this.outputFormat)}  ${p('·')}  ${dim('auto-save')} ${this.autoSave ? chalk.green('on') : dim('off')}`);
    console.log();

    if (stats.articles === 0) {
      console.log(dim('  No articles yet. Use /add to get started.'));
      console.log();
      return;
    }

    // Then lint
    const spin = ora({ text: dim('checking health...'), color: 'white', spinner: 'dots' });
    spin.start();

    const linter = new WikiLinter(this.config.dataDir, this.llm);
    const issues = await linter.lint();

    spin.stop();

    if (issues.length === 0) {
      console.log(chalk.green('  ✓ wiki is healthy — no issues found'));
    } else {
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? chalk.red('✗') :
                     issue.severity === 'warning' ? chalk.yellow('!') :
                     dim('·');
        console.log(`  ${icon} ${dim(`[${issue.article}]`)} ${issue.message}`);
      }

      const e = issues.filter(i => i.severity === 'error').length;
      const w = issues.filter(i => i.severity === 'warning').length;
      const s = issues.filter(i => i.severity === 'suggestion').length;
      console.log(dim(`\n  ${e} errors · ${w} warnings · ${s} suggestions`));
    }
    console.log();
  }

  // ── /rebuild — force recompile ────────────────────────────────

  private async cmdRebuild(): Promise<void> {
    const spin = ora({ text: dim('rebuilding wiki...'), color: 'white', spinner: 'dots' });
    spin.start();

    const compiler = new WikiCompiler(this.config.dataDir, this.llm);
    const result = await compiler.compile({
      batchSize: this.config.compile.batchSize,
      extractConcepts: this.config.compile.extractConcepts,
    });

    spin.stop();

    if (result.articlesCreated.length > 0) {
      console.log(chalk.green(`  ✓ created ${result.articlesCreated.length}:`), result.articlesCreated.join(', '));
    }
    if (result.articlesUpdated.length > 0) {
      console.log(chalk.green(`  ✓ updated ${result.articlesUpdated.length}:`), result.articlesUpdated.join(', '));
    }
    if (result.articlesCreated.length === 0 && result.articlesUpdated.length === 0) {
      console.log(dim('  wiki is up to date — nothing to rebuild'));
    }
    console.log();
  }

  // ── /format ───────────────────────────────────────────────────

  private cmdFormat(format: string): void {
    const valid = ['markdown', 'marp', 'json'];
    if (!format || !valid.includes(format)) {
      console.log(dim(`  current: ${this.outputFormat}`));
      console.log(dim(`  usage: /format <${valid.join('|')}>`));
      return;
    }
    this.outputFormat = format as OutputFormat;
    console.log(dim(`  output format: ${this.outputFormat}`));
  }

  // ── /help ─────────────────────────────────────────────────────

  private cmdHelp(): void {
    console.log();
    console.log(dim('  Just type a question to ask your knowledge base.'));
    console.log(dim('  Use / commands for everything else:'));
    console.log();
    for (const [cmd, info] of Object.entries(SLASH_COMMANDS)) {
      const usage = info.usage || cmd;
      console.log(`  ${accent(usage.padEnd(30))} ${dim(info.description)}`);
    }
    console.log();
    console.log(dim('  tip: drag & drop files into the terminal to add them'));
    console.log(dim('  tip: tab to autocomplete commands'));
    console.log();
  }
}
