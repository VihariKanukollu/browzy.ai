import React from 'react';
import { Text, Box } from 'ink';
import { getTheme } from '../theme.js';
import { loadStreak } from '../personality.js';

const LOGO_TOP = [
  '██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗██╗   ██╗',
  '██╔══██╗██╔══██╗██╔═══██╗██║    ██║╚══███╔╝╚██╗ ██╔╝',
  '██████╔╝██████╔╝██║   ██║██║ █╗ ██║  ███╔╝  ╚████╔╝',
];

const LOGO_BOTTOM = [
  '██╔══██╗██╔══██╗██║   ██║██║███╗██║ ███╔╝    ╚██╔╝',
  '██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████╗   ██║',
  '╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝   ╚═╝',
];

interface BannerProps {
  welcome: string;
  stats: { sources: number; articles: number; concepts: number };
  model: string;
  dataDir: string;
  lastSessionDigest?: string;
  growthDelta?: { articles: number; sources: number };
}

export const Banner: React.FC<BannerProps> = React.memo(({ welcome, stats, model, dataDir, lastSessionDigest, growthDelta }) => {
  const theme = getTheme();
  const streak = loadStreak();

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box flexDirection="column" marginBottom={0}>
        {LOGO_TOP.map((line, i) => (
          <Text key={`top-${i}`} bold color={theme.brand}>{line}</Text>
        ))}
        {LOGO_BOTTOM.map((line, i) => (
          <Text key={`bot-${i}`} color={theme.brandLight}>{line}</Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.accent}>{welcome}</Text>
      </Box>
      <Text color={theme.textMuted}>{''.padEnd(50)}v1.1.0</Text>

      <Box marginTop={1}>
        <Text color={theme.separator}>{'─'.repeat(55)}</Text>
      </Box>

      {/* Stats — playful language */}
      <Box marginTop={1} gap={2}>
        <Text>
          <Text color={theme.textMuted}>sources </Text>
          <Text bold color={theme.text}>{stats.sources}</Text>
        </Text>
        <Text color={theme.textMuted}>·</Text>
        <Text>
          <Text color={theme.textMuted}>articles </Text>
          <Text bold color={theme.text}>{stats.articles}</Text>
        </Text>
        <Text color={theme.textMuted}>·</Text>
        <Text>
          <Text color={theme.textMuted}>concepts </Text>
          <Text bold color={theme.text}>{stats.concepts}</Text>
        </Text>
        {streak.currentStreak >= 2 && (
          <>
            <Text color={theme.textMuted}>·</Text>
            <Text color={theme.accent}>{streak.currentStreak}-day streak</Text>
          </>
        )}
      </Box>
      <Box>
        <Text color={theme.textMuted}>model    </Text>
        <Text color={theme.text}>{model}</Text>
      </Box>

      {lastSessionDigest && (
        <Box marginTop={1}>
          <Text>
            <Text color={theme.textMuted}>Last time: {lastSessionDigest}</Text>
            {growthDelta && growthDelta.articles > 0 && (
              <Text color={theme.accent}> Your browzy grew by {growthDelta.articles} article{growthDelta.articles !== 1 ? 's' : ''} since then.</Text>
            )}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.separator}>{'─'.repeat(55)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {stats.articles === 0 ? (
          <>
            <Text color={theme.accent}>  A blank canvas. Add your first source and watch the magic happen.</Text>
            <Text> </Text>
            <Text><Text color={theme.accent}>  /add {'<url or file>'}  </Text><Text color={theme.textMuted}>Feed your browzy its first source</Text></Text>
          </>
        ) : (
          <>
            <Text color={theme.textMuted}>  Just type a question, or use / commands:</Text>
            <Text><Text color={theme.accent}>  /add {'<sources...>'}   </Text><Text color={theme.textMuted}>Feed your browzy new knowledge</Text></Text>
            <Text><Text color={theme.accent}>  /health              </Text><Text color={theme.textMuted}>How is your browzy doing?</Text></Text>
            <Text><Text color={theme.accent}>  /help                </Text><Text color={theme.textMuted}>All commands</Text></Text>
          </>
        )}
      </Box>
    </Box>
  );
});
