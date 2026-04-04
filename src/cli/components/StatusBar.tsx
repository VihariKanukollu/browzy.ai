import React, { useState, useEffect } from 'react';
import { Text, Box, useStdout } from 'ink';
import { getTheme } from '../theme.js';

interface StatusBarProps {
  model: string;
  sources: number;
  articles: number;
  tokenUsage?: { input: number; output: number };
  hint?: string;
  temporaryStatus?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  sources,
  articles,
  tokenUsage,
  hint,
  temporaryStatus,
}) => {
  const theme = getTheme();
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
  const [showTemp, setShowTemp] = useState(false);

  useEffect(() => {
    if (temporaryStatus) {
      setShowTemp(true);
      const timer = setTimeout(() => setShowTemp(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [temporaryStatus]);

  const left = `${sources} sources · ${articles} articles${articles > 0 ? ' · growing' : ''}`;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.separator}>{'─'.repeat(cols)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Box>
          {showTemp && temporaryStatus ? (
            <Text color={theme.accent}> {temporaryStatus}</Text>
          ) : (
            <Text color={theme.textMuted}> {left}</Text>
          )}
        </Box>
        <Box>
          <Text color={theme.textMuted}>{model} </Text>
        </Box>
      </Box>
      {hint && (
        <Box>
          <Text color={theme.textMuted}> {hint}</Text>
        </Box>
      )}
    </Box>
  );
};
