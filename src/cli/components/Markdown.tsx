import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { getTheme } from '../theme.js';

const tokenCache = new Map<string, string>();
const MAX_CACHE = 500;

// Check a larger sample for markdown syntax
const MD_SYNTAX_RE = /[#*`|[\]>\-_]|\n\n|^\d+\. /;

/**
 * Render markdown as styled terminal text.
 * Handles: headers, bold, italic, code blocks, blockquotes,
 * lists, wiki links, markdown links, horizontal rules, tables.
 * Strikethrough disabled (~ used for "approximately" too often).
 */
export function renderMarkdown(input: string): string {
  // Fast path: skip parsing for plain text (check first 1000 chars)
  if (!MD_SYNTAX_RE.test(input.slice(0, 1000))) {
    return input;
  }

  const cached = tokenCache.get(input);
  if (cached) return cached;

  const theme = getTheme();
  const lines = input.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Display math blocks $$...$$ (standalone lines)
    if (line.trim().startsWith('$$') && !inCodeBlock) {
      // Collect until closing $$
      let mathContent = line.trim().slice(2);
      if (mathContent.endsWith('$$')) {
        // Single-line display math
        mathContent = mathContent.slice(0, -2);
        result.push('  ' + chalk.hex(theme.accent)(latexToUnicode(mathContent.trim())));
        continue;
      }
      // Multi-line: collect until $$
      const mathLines = [mathContent];
      while (++lineIdx < lines.length) {
        const ml = lines[lineIdx];
        if (ml.trim().endsWith('$$')) {
          mathLines.push(ml.trim().slice(0, -2));
          break;
        }
        mathLines.push(ml);
      }
      const fullMath = mathLines.join(' ').trim();
      result.push('  ' + chalk.hex(theme.accent)(latexToUnicode(fullMath)));
      continue;
    }

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        result.push(chalk.dim('  ┌─' + (codeBlockLang ? ` ${codeBlockLang} ` : '') + '─'));
        for (const cl of codeLines) {
          result.push(chalk.dim('  │ ') + chalk.hex(theme.text)(cl));
        }
        result.push(chalk.dim('  └─'));
        codeLines = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Tables: detect pipe-delimited lines
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Skip separator rows (---|---|---)
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      // Flush table
      result.push(...renderTable(tableRows, theme));
      tableRows = [];
      inTable = false;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      const color = level === 1 ? theme.brand : level === 2 ? theme.brandLight : theme.accent;
      result.push(chalk.hex(color).bold(text));
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      result.push(chalk.hex(theme.textMuted)('  │ ') + chalk.italic(formatInline(line.slice(2), theme)));
      continue;
    }

    // Horizontal rules
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      result.push(chalk.hex(theme.separator)('─'.repeat(40)));
      continue;
    }

    // List items — numbered and bulleted
    const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1];
      const content = bulletMatch[3];
      result.push(`${indent}${chalk.hex(theme.accent)('•')} ${formatInline(content, theme)}`);
      continue;
    }

    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (numberedMatch) {
      const indent = numberedMatch[1];
      const num = numberedMatch[2];
      const content = numberedMatch[3];
      result.push(`${indent}${chalk.hex(theme.accent)(num + '.')} ${formatInline(content, theme)}`);
      continue;
    }

    // Regular text with inline formatting
    result.push(formatInline(line, theme));
  }

  // Flush any remaining table
  if (inTable && tableRows.length > 0) {
    result.push(...renderTable(tableRows, theme));
  }

  const output = result.join('\n');

  // LRU-ish cache
  if (tokenCache.size >= MAX_CACHE) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey !== undefined) tokenCache.delete(firstKey);
  }
  tokenCache.set(input, output);

  return output;
}

function formatInline(text: string, theme: ReturnType<typeof getTheme>): string {
  let formatted = text;

  // LaTeX math: inline $...$ and display $$...$$
  formatted = formatted.replace(/\$\$([^$]+)\$\$/g, (_m, tex) =>
    chalk.hex(theme.accent)(latexToUnicode(tex.trim()))
  );
  formatted = formatted.replace(/\$([^$]+)\$/g, (_m, tex) =>
    chalk.hex(theme.accent)(latexToUnicode(tex.trim()))
  );

  // Bold **text**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_m, t) => chalk.bold(t));
  // Italic *text* (not bold)
  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, t) => chalk.italic(t));
  // Inline code `text`
  formatted = formatted.replace(/`([^`]+)`/g, (_m, t) => chalk.hex(theme.accent)(t));
  // Wiki links [[slug]] — internal refs, styled but not clickable
  formatted = formatted.replace(/\[\[([^\]]+)\]\]/g, (_m, t) =>
    chalk.hex(theme.link)(`[${t}]`)
  );
  // Markdown links [text](url) — show URL explicitly since OSC 8 is unreliable through Ink
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    if (text === url) {
      // URL-only link: just show it
      return chalk.hex(theme.link).underline(url);
    }
    // Named link: show text + URL
    return chalk.hex(theme.link).underline(text) + chalk.hex(theme.textMuted)(` (${url})`);
  });
  // Escaped characters
  formatted = formatted.replace(/\\([()\\`*_{}[\]#+-.])/g, '$1');

  return formatted;
}

// ── LaTeX to Unicode ────────────────────────────────────────────

const LATEX_SYMBOLS: Record<string, string> = {
  // Greek
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
  '\\epsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ',
  '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ',
  '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
  '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
  '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
  '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
  '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ',
  '\\Psi': 'Ψ', '\\Omega': 'Ω',
  // Operators
  '\\times': '×', '\\div': '÷', '\\cdot': '·', '\\pm': '±',
  '\\mp': '∓', '\\leq': '≤', '\\geq': '≥', '\\neq': '≠',
  '\\approx': '≈', '\\equiv': '≡', '\\sim': '∼', '\\propto': '∝',
  '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
  // Set theory
  '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\supset': '⊃',
  '\\subseteq': '⊆', '\\supseteq': '⊇', '\\cup': '∪', '\\cap': '∩',
  '\\emptyset': '∅', '\\varnothing': '∅',
  // Logic
  '\\forall': '∀', '\\exists': '∃', '\\neg': '¬', '\\land': '∧',
  '\\lor': '∨', '\\implies': '⟹', '\\iff': '⟺',
  '\\therefore': '∴', '\\because': '∵',
  // Arrows
  '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←',
  '\\leftrightarrow': '↔', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
  '\\mapsto': '↦',
  // Big operators
  '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\oint': '∮',
  '\\bigcup': '⋃', '\\bigcap': '⋂', '\\bigoplus': '⊕',
  // Misc
  '\\star': '⋆', '\\circ': '∘', '\\bullet': '•',
  '\\ldots': '…', '\\cdots': '⋯', '\\vdots': '⋮', '\\ddots': '⋱',
  '\\langle': '⟨', '\\rangle': '⟩',
  '\\lceil': '⌈', '\\rceil': '⌉', '\\lfloor': '⌊', '\\rfloor': '⌋',
  '\\triangle': '△', '\\square': '□', '\\diamond': '◇',
  '\\perp': '⊥', '\\parallel': '∥', '\\angle': '∠',
  '\\checkmark': '✓', '\\qed': '∎',
};

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'd': 'ᵈ', 'k': 'ᵏ', 'a': 'ᵃ',
  'b': 'ᵇ', 'c': 'ᶜ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ',
  'h': 'ʰ', 'j': 'ʲ', 'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ',
  'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ',
  'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
  'T': 'ᵀ',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ',
  'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ',
  't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ',
};

const MATHBB: Record<string, string> = {
  'A': '𝔸', 'B': '𝔹', 'C': 'ℂ', 'D': '𝔻', 'E': '𝔼',
  'F': '𝔽', 'G': '𝔾', 'H': 'ℍ', 'I': '𝕀', 'J': '𝕁',
  'K': '𝕂', 'L': '𝕃', 'M': '𝕄', 'N': 'ℕ', 'O': '𝕆',
  'P': 'ℙ', 'Q': 'ℚ', 'R': 'ℝ', 'S': '𝕊', 'T': '𝕋',
  'U': '𝕌', 'V': '𝕍', 'W': '𝕎', 'X': '𝕏', 'Y': '𝕐', 'Z': 'ℤ',
};

const MATHCAL: Record<string, string> = {
  'A': '𝒜', 'B': 'ℬ', 'C': '𝒞', 'D': '𝒟', 'E': 'ℰ',
  'F': 'ℱ', 'G': '𝒢', 'H': 'ℋ', 'I': 'ℐ', 'J': '𝒥',
  'K': '𝒦', 'L': 'ℒ', 'M': 'ℳ', 'N': '𝒩', 'O': '𝒪',
  'P': '𝒫', 'Q': '𝒬', 'R': 'ℛ', 'S': '𝒮', 'T': '𝒯',
  'U': '𝒰', 'V': '𝒱', 'W': '𝒲', 'X': '𝒳', 'Y': '𝒴', 'Z': '𝒵',
};

function latexToUnicode(tex: string): string {
  let result = tex;

  // \mathbb{X} → double-struck
  result = result.replace(/\\mathbb\{([A-Z])\}/g, (_m, c) => MATHBB[c] || c);

  // \mathcal{X} → calligraphic
  result = result.replace(/\\mathcal\{([A-Z])\}/g, (_m, c) => MATHCAL[c] || c);

  // \text{...} → just the text
  result = result.replace(/\\text\{([^}]*)\}/g, '$1');
  result = result.replace(/\\textbf\{([^}]*)\}/g, '$1');
  result = result.replace(/\\mathrm\{([^}]*)\}/g, '$1');

  // Fractions \frac{a}{b} → a/b
  result = result.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1/$2)');

  // Square root \sqrt{x} → √x
  result = result.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');
  result = result.replace(/\\sqrt\[(\d+)\]\{([^}]*)\}/g, '$1√($2)');

  // Superscripts ^{...} → Unicode superscript
  result = result.replace(/\^{([^}]*)}/g, (_m, inner) => {
    return inner.split('').map((c: string) => SUPERSCRIPTS[c] || c).join('');
  });
  result = result.replace(/\^([a-zA-Z0-9])/g, (_m, c) => SUPERSCRIPTS[c] || `^${c}`);

  // Subscripts _{...} → Unicode subscript
  result = result.replace(/_{([^}]*)}/g, (_m, inner) => {
    return inner.split('').map((c: string) => SUBSCRIPTS[c] || c).join('');
  });
  result = result.replace(/_([a-zA-Z0-9])/g, (_m, c) => SUBSCRIPTS[c] || `_${c}`);

  // Named symbols
  for (const [cmd, sym] of Object.entries(LATEX_SYMBOLS)) {
    // Use word boundary to avoid partial matches
    result = result.split(cmd).join(sym);
  }

  // \left and \right delimiters
  result = result.replace(/\\left\s*/g, '');
  result = result.replace(/\\right\s*/g, '');
  result = result.replace(/\\big\s*/g, '');
  result = result.replace(/\\Big\s*/g, '');

  // Clean up remaining backslash commands we don't handle
  result = result.replace(/\\[a-zA-Z]+/g, (match) => match.slice(1));

  // Clean up extra braces
  result = result.replace(/\{([^{}]*)\}/g, '$1');
  result = result.replace(/\{([^{}]*)\}/g, '$1'); // Second pass for nested

  // Clean whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

function renderTable(rows: string[][], theme: ReturnType<typeof getTheme>): string[] {
  if (rows.length === 0) return [];

  // Calculate column widths
  const colCount = Math.max(...rows.map(r => r.length));
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    colWidths.push(Math.max(...rows.map(r => (r[c] || '').length), 3));
  }

  const result: string[] = [];
  const separator = chalk.dim('  ' + colWidths.map(w => '─'.repeat(w + 2)).join('┼'));

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r];
    const line = cells.map((cell, c) => {
      const padded = (cell || '').padEnd(colWidths[c] || 3);
      return r === 0 ? chalk.bold(padded) : padded;
    }).join(chalk.dim(' │ '));

    result.push('  ' + line);
    if (r === 0) result.push(separator);
  }

  return result;
}

/**
 * Ink component for rendering markdown.
 */
export const MarkdownText: React.FC<{ children: string }> = React.memo(({ children }) => {
  const rendered = renderMarkdown(children);
  return <Text>{rendered}</Text>;
});
