import { useState, useCallback, useRef } from 'react';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HISTORY_FILE = join(homedir(), '.browzy', 'history.json');
const MAX_HISTORY = 500;

function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistory(items: string[]): void {
  mkdirSync(join(homedir(), '.browzy'), { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(items.slice(-MAX_HISTORY)), 'utf-8');
}

export function useHistory() {
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stashedInput, setStashedInput] = useState('');

  // Refs to avoid stale closures during rapid keypresses
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;
  const historyRef = useRef(history);
  historyRef.current = history;
  const stashedRef = useRef(stashedInput);
  stashedRef.current = stashedInput;

  const addToHistory = useCallback((input: string) => {
    if (!input.trim()) return;
    setHistory(prev => {
      // Deduplicate consecutive
      if (prev[prev.length - 1] === input) return prev;
      const next = [...prev, input];
      saveHistory(next);
      return next;
    });
    setHistoryIndex(-1);
  }, []);

  const navigateHistory = useCallback((direction: 'up' | 'down', currentInput: string): string | null => {
    const h = historyRef.current;
    const idx = historyIndexRef.current;

    if (h.length === 0) return null;

    if (idx === -1 && direction === 'up') {
      setStashedInput(currentInput);
      const newIdx = h.length - 1;
      setHistoryIndex(newIdx);
      historyIndexRef.current = newIdx;
      return h[newIdx];
    }

    if (direction === 'up') {
      const newIdx = Math.max(0, idx - 1);
      setHistoryIndex(newIdx);
      historyIndexRef.current = newIdx;
      return h[newIdx];
    }

    // Down
    if (idx >= h.length - 1) {
      setHistoryIndex(-1);
      historyIndexRef.current = -1;
      return stashedRef.current;
    }

    const newIdx = idx + 1;
    setHistoryIndex(newIdx);
    historyIndexRef.current = newIdx;
    return h[newIdx];
  }, []);

  const searchHistory = useCallback((query: string): string[] => {
    const h = historyRef.current;
    if (!query) return h.slice(-10).reverse();
    const lower = query.toLowerCase();
    const seen = new Set<string>();
    const results: string[] = [];
    for (let i = h.length - 1; i >= 0 && results.length < 10; i--) {
      const item = h[i];
      if (item.toLowerCase().includes(lower) && !seen.has(item)) {
        seen.add(item);
        results.push(item);
      }
    }
    return results;
  }, []);

  return {
    history,
    historyIndex,
    addToHistory,
    navigateHistory,
    searchMode,
    setSearchMode,
    searchQuery,
    setSearchQuery,
    searchHistory,
    stashedInput,
    setStashedInput,
  };
}
