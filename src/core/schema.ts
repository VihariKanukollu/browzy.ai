import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCHEMA_FILENAME = 'browzy.schema.md';
const MAX_SCHEMA_CHARS = 4000;

export const DEFAULT_SCHEMA = `# browzy.schema.md
# This file controls how your knowledge base compiles and answers questions.
# Edit it to customize browzy's behavior for YOUR domain.
# Lines starting with # are comments and have no effect.
# Delete this comment block and add your preferences below.

# ## Identity
# Who is this knowledge base for? What domain does it cover?
# Example: This is a machine learning research wiki maintained by a PhD student.

# ## Compilation preferences
# How should sources be compiled into articles?
# Example: Emphasize mathematical rigor. Preserve all equations and proofs.

# ## Query behavior
# How should questions be answered?
# Example: Always include code examples when discussing algorithms.

# ## Terminology
# Define preferred terms for consistency.
# Example: Use 'neural network' not 'neural net'. Use 'LLM' not 'large language model'.

# ## Topics to emphasize
# What topics matter most?
# Example: Focus on practical implementation details, not just theory.

# ## Topics to skip
# What should be de-emphasized?
# Example: Skip biographical details about authors.
`;

export function schemaPath(dataDir: string): string {
  return join(dataDir, SCHEMA_FILENAME);
}

export function readSchema(dataDir: string): string | null {
  const p = schemaPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    const content = readFileSync(p, 'utf-8');
    // Only return if there are non-comment, non-blank lines (user actually edited it)
    const userLines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    if (userLines.length === 0) return null;
    // Cap at MAX_SCHEMA_CHARS
    return content.slice(0, MAX_SCHEMA_CHARS);
  } catch { return null; }
}

export function ensureSchema(dataDir: string): string {
  const p = schemaPath(dataDir);
  if (!existsSync(p)) {
    writeFileSync(p, DEFAULT_SCHEMA, 'utf-8');
  }
  return p;
}
