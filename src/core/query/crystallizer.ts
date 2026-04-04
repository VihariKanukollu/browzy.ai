import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { LLMProvider } from '../llm/provider.js';
import { CRYSTALLIZER_PROMPT } from '../prompts.js';
import { sanitizeUnicode } from '../sanitization.js';

export interface CrystallizeResult {
  saved: boolean;
  slug?: string;
  title?: string;
}

export async function crystallize(
  question: string,
  answer: string,
  sourcesUsed: string[],
  sourceContents: Array<{ slug: string; content: string }>,
  dataDir: string,
  llm: LLMProvider,
): Promise<CrystallizeResult> {
  // Gate 1: Must have synthesized from 2+ articles
  if (sourcesUsed.length < 2) return { saved: false };

  // Gate 2: Source contents must be provided so LLM can check novelty
  if (sourceContents.length < 2) return { saved: false };

  // Build context: the answer + the source articles it drew from
  const sourceContext = sourceContents
    .slice(0, 5) // Max 5 sources to keep prompt reasonable
    .map(s => `### [[${s.slug}]]\n${s.content.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const prompt = `## Question asked
${question}

## Answer given
${answer.slice(0, 3000)}

## Source articles used
${sourceContext}`;

  const response = await llm.chat(
    [{ role: 'user', content: prompt }],
    { system: CRYSTALLIZER_PROMPT, maxTokens: 800 }
  );

  const result = response.content.trim();

  // The LLM outputs NONE if no novel insight, or an article in ===ARTICLE=== format
  if (result === 'NONE' || (result.includes('NONE') && !result.includes('===ARTICLE==='))) {
    return { saved: false };
  }

  // Parse the article output
  const articleMatch = result.match(/===ARTICLE===([\s\S]*?)===END===/);
  if (!articleMatch) return { saved: false };

  const articleContent = articleMatch[1].trim();
  const slugMatch = articleContent.match(/SLUG:\s*(.+)/);
  const titleMatch = articleContent.match(/TITLE:\s*(.+)/);

  if (!slugMatch || !titleMatch) return { saved: false };

  const slug = slugMatch[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80);
  const title = sanitizeUnicode(titleMatch[1].trim());

  // Extract content (everything after SUMMARY line)
  const summaryIdx = articleContent.indexOf('SUMMARY:');
  if (summaryIdx === -1) return { saved: false }; // malformed output
  const contentStart = articleContent.indexOf('\n', summaryIdx);
  const content = contentStart > -1 ? articleContent.slice(contentStart).trim() : '';
  if (!content || content.length < 50) return { saved: false }; // Too short = not valuable

  // Write to drafts/ directory (NOT wiki/)
  const draftsDir = join(dataDir, 'drafts');
  mkdirSync(draftsDir, { recursive: true });

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `tags: [insight, derived]`,
    `sources: [${sourcesUsed.map(s => JSON.stringify(s)).join(', ')}]`,
    `derived: true`,
    `created: ${JSON.stringify(new Date().toISOString())}`,
    `question: ${JSON.stringify(question.slice(0, 200))}`,
    '---',
    '',
    content,
  ].join('\n');

  writeFileSync(join(draftsDir, `${slug}.md`), frontmatter, 'utf-8');

  return { saved: true, slug, title };
}
