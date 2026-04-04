/**
 * Clipboard watcher — opt-in only.
 * Polls the system clipboard for new text content (>50 words, not a URL, not code-heavy).
 * OFF by default. Enable via config.clipboard.enabled = true.
 */

import { execSync } from 'child_process';

let lastClipContent = '';

export function getClipboardText(): string | null {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf-8', timeout: 1000 });
    } else if (platform === 'linux') {
      try {
        return execSync('xclip -selection clipboard -o', { encoding: 'utf-8', timeout: 1000 });
      } catch {
        return execSync('xsel --clipboard --output', { encoding: 'utf-8', timeout: 1000 });
      }
    } else if (platform === 'win32') {
      return execSync('powershell -command Get-Clipboard', { encoding: 'utf-8', timeout: 2000 });
    }
    return null;
  } catch {
    return null;
  }
}

export function checkClipboardChange(): string | null {
  const current = getClipboardText();
  if (!current) return null;
  if (current === lastClipContent) return null;

  lastClipContent = current;

  // Must be >50 words, not code-heavy
  const trimmed = current.trim();
  const words = trimmed.split(/\s+/).length;
  if (words < 50) return null;

  // Only skip if clipboard content is JUST a URL (no surrounding text)
  if (/^https?:\/\/\S+$/i.test(trimmed)) return null;

  // Skip content that looks like API keys or sensitive data
  if (/(?:sk-[a-zA-Z0-9_-]{20,}|AKIA[A-Z0-9]{16}|\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b)/i.test(trimmed)) return null;

  // Skip code-heavy content (lots of braces, semicolons, or indentation)
  const codeSignals = (current.match(/[{};()=>]/g) || []).length;
  if (codeSignals > words * 0.15) return null;

  return current;
}

export function initClipboard(): void {
  // Initialize with current clipboard so we don't immediately ingest existing content
  lastClipContent = getClipboardText() || '';
}
