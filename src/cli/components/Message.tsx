import React from 'react';
import { Text, Box } from 'ink';
import { getTheme } from '../theme.js';
import { renderMarkdown } from './Markdown.js';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageData {
  id: string;
  role: MessageRole;
  content: string;
  sources?: string[];
  timestamp: number;
}

interface MessageProps {
  message: MessageData;
}

export const Message: React.FC<MessageProps> = React.memo(({ message }) => {
  const theme = getTheme();

  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Text bold color={theme.userMessage}>{'› '}{message.content}</Text>
      </Box>
    );
  }

  if (message.role === 'system') {
    return (
      <Box marginBottom={1} paddingLeft={2}>
        <Text color={theme.systemMessage}>{message.content}</Text>
      </Box>
    );
  }

  // Assistant message — render with markdown
  const rendered = renderMarkdown(message.content);

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      <Text>{rendered}</Text>
      {message.sources && message.sources.length > 0 && (
        <Box marginTop={1}>
          <Text color={theme.textMuted}>
            sources: {message.sources.join(', ')}
          </Text>
        </Box>
      )}
    </Box>
  );
});
