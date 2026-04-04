/**
 * browzy.ai — API key storage.
 *
 * Stores API keys in ~/.browzy/keys.json with restricted permissions.
 * Keys are loaded into memory at startup and can be added at runtime
 * via /model without restarting.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const KEYS_FILE = join(homedir(), '.browzy', 'keys.json');

interface KeyStore {
  anthropic?: string;
  openai?: string;
  openrouter?: string;
}

export function loadKeys(): KeyStore {
  try {
    if (existsSync(KEYS_FILE)) {
      const parsed = JSON.parse(readFileSync(KEYS_FILE, 'utf-8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

export function saveKey(provider: 'anthropic' | 'openai' | 'openrouter', key: string): void {
  mkdirSync(join(homedir(), '.browzy'), { recursive: true });
  const keys = loadKeys();
  keys[provider] = key;
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(KEYS_FILE, 0o600); } catch { /* ensure perms even if file existed */ }
}

/**
 * Get API key for a provider. Checks:
 * 1. Environment variable
 * 2. ~/.browzy/keys.json
 */
export function getKey(provider: 'anthropic' | 'openai' | 'openrouter'): string | undefined {
  const envMap = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };

  return process.env[envMap[provider]] || loadKeys()[provider] || undefined;
}

/**
 * Detect if a string looks like an API key.
 */
export function looksLikeApiKey(input: string): { provider: 'anthropic' | 'openai' | 'openrouter'; key: string } | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('sk-ant-')) return { provider: 'anthropic', key: trimmed };
  if (trimmed.startsWith('sk-or-')) return { provider: 'openrouter', key: trimmed };
  if (trimmed.startsWith('sk-') && trimmed.length > 30) return { provider: 'openai', key: trimmed };
  return null;
}
