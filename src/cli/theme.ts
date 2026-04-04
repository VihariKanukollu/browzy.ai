/**
 * browzy.ai design tokens — based on the official palette.
 */

export interface Theme {
  brand: string;
  brandLight: string;
  brandDim: string;
  accent: string;
  text: string;
  textDim: string;
  textMuted: string;
  success: string;
  warning: string;
  error: string;
  userMessage: string;
  aiMessage: string;
  systemMessage: string;
  separator: string;
  codeBlock: string;
  link: string;
}

// Palette: #EFEAF9 #CDBDED #AD8FE1 #8F60D3 #6C3BAA #44236E #200D37
// Grays:   #EDEDEE #C5C4C7 #9F9DA3 #7A787F #57555C #363539 #18171A
export const darkTheme: Theme = {
  brand: '#6C3BAA',       // Primary purple
  brandLight: '#8F60D3',  // Lighter purple
  brandDim: '#44236E',    // Darker purple
  accent: '#AD8FE1',      // Soft lavender for accents
  text: '#EDEDEE',        // Light gray text
  textDim: '#C5C4C7',     // Secondary text
  textMuted: '#7A787F',   // Muted text
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',
  userMessage: '#8F60D3', // User questions in lighter purple
  aiMessage: '#EDEDEE',   // AI answers in white
  systemMessage: '#9F9DA3', // System messages in mid-gray
  separator: '#6C3BAA',
  codeBlock: '#200D37',   // Darkest purple for code bg
  link: '#AD8FE1',        // Lavender for links
};

export const lightTheme: Theme = {
  brand: '#6C3BAA',
  brandLight: '#8F60D3',
  brandDim: '#CDBDED',
  accent: '#44236E',
  text: '#18171A',
  textDim: '#363539',
  textMuted: '#7A787F',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  userMessage: '#6C3BAA',
  aiMessage: '#18171A',
  systemMessage: '#57555C',
  separator: '#6C3BAA',
  codeBlock: '#EFEAF9',
  link: '#44236E',
};

export function detectTheme(): Theme {
  if (process.env.BROWZY_THEME === 'light') return lightTheme;
  if (process.env.BROWZY_THEME === 'dark') return darkTheme;

  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return darkTheme;

  const colorScheme = process.env.COLORFGBG;
  if (colorScheme) {
    const parts = colorScheme.split(';');
    const bg = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(bg)) {
      if (bg >= 0 && bg <= 7) return darkTheme;
      if (bg >= 8 && bg <= 15) return lightTheme;
    }
  }

  return darkTheme;
}

export function getTheme(): Theme {
  return detectTheme();
}
