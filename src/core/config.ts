import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { BrowzyConfig } from './types.js';

const DEFAULT_DATA_DIR = join(homedir(), '.browzy', 'default');

const DEFAULT_CONFIG: BrowzyConfig = {
  dataDir: DEFAULT_DATA_DIR,
  llm: {
    provider: 'claude',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
  },
  compile: {
    batchSize: 20,
    extractConcepts: true,
  },
};

/**
 * Load config from browzy.config.json in the current directory,
 * or from ~/.browzy/config.json, or use defaults.
 */
export function loadConfig(configPath?: string): BrowzyConfig {
  const candidates = configPath
    ? [configPath]
    : [
        join(process.cwd(), 'browzy.config.json'),
        join(homedir(), '.browzy', 'config.json'),
      ];

  for (const path of candidates) {
    if (existsSync(path)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, 'utf-8'));
      } catch {
        throw new Error(`Invalid JSON in config file: ${path}`);
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Invalid config: expected an object in ${path}`);
      }
      const obj = parsed as Record<string, unknown>;
      if (obj.dataDir !== undefined && typeof obj.dataDir !== 'string') {
        throw new Error(`Invalid config: dataDir must be a string`);
      }
      if (obj.llm !== undefined && (typeof obj.llm !== 'object' || obj.llm === null)) {
        throw new Error(`Invalid config: llm must be an object`);
      }
      return mergeConfig(DEFAULT_CONFIG, obj as Partial<BrowzyConfig>);
    }
  }

  // Apply env vars as overrides
  return applyEnvOverrides(DEFAULT_CONFIG);
}

function mergeConfig(
  defaults: BrowzyConfig,
  overrides: Partial<BrowzyConfig>
): BrowzyConfig {
  const merged: BrowzyConfig = {
    ...defaults,
    ...overrides,
    llm: { ...defaults.llm, ...overrides.llm },
    compile: { ...defaults.compile, ...overrides.compile },
  };
  return applyEnvOverrides(merged);
}

function applyEnvOverrides(config: BrowzyConfig): BrowzyConfig {
  if (process.env.ANTHROPIC_API_KEY && config.llm.provider === 'claude') {
    config.llm.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENAI_API_KEY && config.llm.provider === 'openai') {
    config.llm.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY && config.llm.provider === 'openrouter') {
    config.llm.apiKey = process.env.OPENROUTER_API_KEY;
  }
  if (process.env.BROWZY_DATA_DIR) {
    config.dataDir = process.env.BROWZY_DATA_DIR;
  }
  return config;
}

/**
 * Ensure the data directory structure exists.
 */
export function ensureDataDirs(config: BrowzyConfig): void {
  const dirs = [
    config.dataDir,
    join(config.dataDir, 'raw'),
    join(config.dataDir, 'raw', 'images'),
    join(config.dataDir, 'wiki'),
    join(config.dataDir, 'output'),
    join(config.dataDir, '.browzy'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}
