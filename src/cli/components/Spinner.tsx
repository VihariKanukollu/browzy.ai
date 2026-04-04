import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { getTheme } from '../theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerProps {
  label?: string;
  elapsed?: number;
}

export const BrowzySpinner: React.FC<SpinnerProps> = ({ label, elapsed }) => {
  const [frame, setFrame] = useState(0);
  const theme = getTheme();

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  const elapsedStr = elapsed !== undefined && elapsed > 2
    ? ` ${elapsed.toFixed(1)}s`
    : '';

  return (
    <Text>
      <Text color={theme.accent}>{FRAMES[frame]}</Text>
      {label && <Text color={theme.textDim}> {label}</Text>}
      {elapsedStr && <Text color={theme.textMuted}>{elapsedStr}</Text>}
    </Text>
  );
};
