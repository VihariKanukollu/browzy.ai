import React from 'react';
import { Text, Box } from 'ink';
import { getTheme } from '../theme.js';

export interface Suggestion {
  name: string;
  description: string;
  usage?: string;
}

interface SuggestionsProps {
  items: Suggestion[];
  selectedIndex: number;
  visible: boolean;
}

const MAX_VISIBLE = 5;

export const SuggestionList: React.FC<SuggestionsProps> = ({ items, selectedIndex, visible }) => {
  const theme = getTheme();

  if (!visible || items.length === 0) return null;

  const visibleItems = items.slice(0, MAX_VISIBLE);

  return (
    <Box flexDirection="column" marginTop={0}>
      {visibleItems.map((item, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={item.name}>
            <Text
              color={isSelected ? theme.accent : theme.textDim}
              bold={isSelected}
            >
              {isSelected ? '› ' : '  '}
              {(item.usage || item.name).padEnd(28)}
            </Text>
            <Text color={theme.textMuted}>{item.description}</Text>
          </Box>
        );
      })}
      {items.length > MAX_VISIBLE && (
        <Text color={theme.textMuted}>  ... {items.length - MAX_VISIBLE} more</Text>
      )}
    </Box>
  );
};
