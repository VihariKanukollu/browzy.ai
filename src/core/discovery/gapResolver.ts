import { searchWeb } from './webSearch.js';

export async function resolveGap(gapTerm: string): Promise<{ url: string; title: string; snippet: string } | null> {
  // Build a focused search query
  const query = `${gapTerm} overview tutorial explanation`;
  return searchWeb(query);
}
