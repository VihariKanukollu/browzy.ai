import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, ensureDataDirs, createProvider } from '../core/index.js';
import type { BrowzyConfig } from '../core/types.js';
import type { LLMProvider } from '../core/llm/provider.js';

export function getConfig(): BrowzyConfig {
  return loadConfig();
}

export function getConfigAndLLM(): { config: BrowzyConfig; llm: LLMProvider } {
  const config = loadConfig();
  const llm = createProvider(config.llm);
  return { config, llm };
}

export function ensureDirs(config: BrowzyConfig): void {
  ensureDataDirs(config);
}

export function spinner(text: string) {
  return ora({ text, color: 'cyan' });
}

export function success(msg: string): void {
  console.log(chalk.green('✓'), msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠'), msg);
}

export function error(msg: string): void {
  console.log(chalk.red('✗'), msg);
}

export function info(msg: string): void {
  console.log(chalk.blue('ℹ'), msg);
}

export function table(data: Record<string, unknown>[]): void {
  console.table(data);
}
