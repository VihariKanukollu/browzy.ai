import { searchWeb } from './webSearch.js';

// Common words that should never trigger gap resolution
const GAP_BLACKLIST = new Set([
  'hello', 'world', 'test', 'example', 'sample', 'demo', 'basic',
  'simple', 'first', 'introduction', 'getting', 'started', 'guide',
  'thing', 'stuff', 'something', 'everything', 'anything', 'nothing',
]);

export async function resolveGap(gapTerm: string): Promise<{ url: string; title: string; snippet: string } | null> {
  // Skip blacklisted terms that produce garbage suggestions
  if (GAP_BLACKLIST.has(gapTerm.toLowerCase())) return null;

  // Skip very short terms — they're too ambiguous for web search
  if (gapTerm.length < 5) return null;

  // Build a focused search query — use "research" instead of "tutorial"
  // to get academic/substantive results, not beginner guides
  const query = `${gapTerm} research paper overview`;
  return searchWeb(query);
}
