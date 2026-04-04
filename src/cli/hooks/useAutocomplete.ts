import { useState, useCallback, useMemo } from 'react';
import type { Suggestion } from '../components/Suggestions.js';

const COMMANDS: Suggestion[] = [
  { name: '/add', description: 'Feed your browzy new knowledge', usage: '/add <urls or paths...>' },
  { name: '/search', description: 'Find articles in your browzy', usage: '/search <term>' },
  { name: '/format', description: 'Output format: markdown, marp, json', usage: '/format <type>' },
  { name: '/copy', description: 'Copy last answer to clipboard' },
  { name: '/health', description: 'How is your browzy doing?' },
  { name: '/model', description: 'Switch models', usage: '/model [model-id]' },
  { name: '/rebuild', description: 'Recompile from scratch' },
  { name: '/export', description: 'Save this session as markdown' },
  { name: '/clear', description: 'Clear conversation' },
  { name: '/help', description: 'All commands' },
  { name: '/quit', description: 'Exit' },
];

export function useAutocomplete() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const getMatches = useCallback((input: string): Suggestion[] => {
    if (!input.startsWith('/')) return [];
    const query = input.toLowerCase();
    return COMMANDS.filter(c => c.name.startsWith(query));
  }, []);

  const updateForInput = useCallback((input: string) => {
    if (input.startsWith('/') && !input.includes(' ')) {
      const matches = getMatches(input);
      setVisible(matches.length > 0 && input !== matches[0]?.name);
      setSelectedIndex(0);
    } else {
      setVisible(false);
    }
  }, [getMatches]);

  const moveSelection = useCallback((direction: 'up' | 'down', input: string) => {
    const matches = getMatches(input);
    if (matches.length === 0) return;

    setSelectedIndex(prev => {
      if (direction === 'up') return Math.max(0, prev - 1);
      return Math.min(matches.length - 1, prev + 1);
    });
  }, [getMatches]);

  const acceptSuggestion = useCallback((input: string): string | null => {
    const matches = getMatches(input);
    if (matches.length === 0 || !visible) return null;
    const selected = matches[selectedIndex];
    if (!selected) return null;
    setVisible(false);
    return selected.name + ' ';
  }, [getMatches, selectedIndex, visible]);

  const getGhostText = useCallback((input: string): string => {
    if (!visible) return '';
    const matches = getMatches(input);
    if (matches.length === 0) return '';
    const match = matches[selectedIndex] || matches[0];
    if (!match || !match.name.startsWith(input)) return '';
    return match.name.slice(input.length);
  }, [getMatches, selectedIndex, visible]);

  return {
    getMatches,
    selectedIndex,
    visible,
    updateForInput,
    moveSelection,
    acceptSuggestion,
    getGhostText,
    setVisible,
  };
}
