import { appendFileSync, readFileSync, existsSync, statSync, renameSync } from 'fs';
import { join } from 'path';

const LOG_FILENAME = 'log.md';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB

export class ActivityLog {
  private logPath: string;

  constructor(dataDir: string) {
    this.logPath = join(dataDir, LOG_FILENAME);
  }

  private append(entry: string): void {
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `- **${ts}** ${entry}\n`;

    // Rotate if too large
    try {
      if (existsSync(this.logPath) && statSync(this.logPath).size > MAX_LOG_BYTES) {
        renameSync(this.logPath, this.logPath.replace('.md', `.${Date.now()}.md`));
      }
    } catch { /* rotation is best-effort */ }

    appendFileSync(this.logPath, line, 'utf-8');
  }

  logIngest(title: string, type: string, origin: string): void {
    this.append(`[INGEST] "${title}" (${type}) from \`${origin.slice(0, 80)}\``);
  }

  logCompile(created: number, updated: number, concepts: number): void {
    this.append(`[COMPILE] ${created} created, ${updated} updated, ${concepts} concepts`);
  }

  logQuery(question: string, sourcesUsed: string[], confidence: string): void {
    const slugs = sourcesUsed.slice(0, 5).map(s => `[[${s}]]`).join(', ');
    const q = question.length > 80 ? question.slice(0, 80) + '...' : question;
    this.append(`[QUERY] "${q}" — ${confidence} confidence, ${sourcesUsed.length} sources: ${slugs}`);
  }

  logLint(errors: number, warnings: number, suggestions: number): void {
    this.append(`[HEALTH] ${errors} errors, ${warnings} warnings, ${suggestions} suggestions`);
  }

  logInsight(slug: string): void {
    this.append(`[INSIGHT] Drafted [[${slug}]]`);
  }

  logRefresh(updated: number): void {
    this.append(`[REFRESH] ${updated} sources refreshed`);
  }

  readRecent(count = 20): string {
    if (!existsSync(this.logPath)) return '(no activity yet)';
    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());
      return lines.slice(-count).join('\n');
    } catch { return '(unable to read log)'; }
  }
}
