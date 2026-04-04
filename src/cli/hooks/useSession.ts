import { useState, useCallback } from 'react';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { MessageData } from '../components/Message.js';

const SESSIONS_DIR = join(homedir(), '.browzy', 'sessions');
const META_PATH = join(SESSIONS_DIR, 'last-session-meta.json');
const MAX_SESSIONS = 50;

export interface Session {
  id: string;
  messages: MessageData[];
  createdAt: string;
  lastUpdated: string;
}

export interface SessionMeta {
  sessionId: string;
  articleCount: number;
  sourceCount: number;
  conceptCount: number;
  digestPath?: string;
  savedAt: string;
}

/**
 * Load the last session's metadata (stats snapshot + digest path).
 */
export function loadSessionMeta(): SessionMeta | null {
  try {
    if (!existsSync(META_PATH)) return null;
    return JSON.parse(readFileSync(META_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update the meta file with a digest path after generation.
 */
export function updateSessionMetaDigest(digestPath: string): void {
  try {
    const meta = loadSessionMeta();
    if (!meta) return;
    meta.digestPath = digestPath;
    writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Redact sensitive patterns from exported text.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/sk-ant-[a-zA-Z0-9\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[a-zA-Z0-9\-_]{48,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9\-_.]{20,}/gi, 'Bearer [REDACTED]');
}

export function useSession() {
  const [sessionId] = useState(() => generateId());
  const [messages, setMessages] = useState<MessageData[]>([]);

  const addMessage = useCallback((role: MessageData['role'], content: string, sources?: string[]) => {
    const msg: MessageData = {
      id: generateId(),
      role,
      content,
      sources,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    return msg;
  }, []);

  const saveSession = useCallback(() => {
    if (messages.length === 0) return;
    mkdirSync(SESSIONS_DIR, { recursive: true });

    const session: Session = {
      id: sessionId,
      messages,
      createdAt: messages[0]?.timestamp ? new Date(messages[0].timestamp).toISOString() : new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    // Write directly — atomic write-then-rename was removed because it races
    // with process exit on /quit (SIGINT/SIGTERM handlers call saveOnce synchronously,
    // and rename may not complete before the process dies). Direct write is safer here
    // since the signal handlers already ensure single-writer via savedRef guard.
    const finalPath = join(SESSIONS_DIR, `${sessionId}.json`);
    writeFileSync(finalPath, JSON.stringify(session, null, 2), 'utf-8');

    // Prune old sessions — sort by mtime, keep newest
    try {
      const files = readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp') && f !== 'last-session-meta.json')
        .map(f => ({
          name: f,
          mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of files.slice(MAX_SESSIONS)) {
        try { unlinkSync(join(SESSIONS_DIR, file.name)); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, [sessionId, messages]);

  const saveSessionMeta = useCallback((stats: { articles: number; sources: number; concepts: number }) => {
    if (messages.length === 0) return;
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const meta: SessionMeta = {
      sessionId,
      articleCount: stats.articles,
      sourceCount: stats.sources,
      conceptCount: stats.concepts,
      savedAt: new Date().toISOString(),
    };
    try {
      writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }, [sessionId, messages]);

  const loadLastSession = useCallback((): Session | null => {
    try {
      if (!existsSync(SESSIONS_DIR)) return null;
      const files = readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp') && f !== 'last-session-meta.json')
        .map(f => ({
          name: f,
          mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) return null;
      return JSON.parse(readFileSync(join(SESSIONS_DIR, files[0].name), 'utf-8'));
    } catch {
      return null;
    }
  }, []);

  const exportSession = useCallback((outputPath: string): string => {
    mkdirSync(join(outputPath, '..'), { recursive: true });

    const lines: string[] = [
      '---',
      `title: "browzy session ${sessionId}"`,
      `date: "${new Date().toISOString()}"`,
      `messageCount: ${messages.length}`,
      '---',
      '',
    ];

    for (const msg of messages) {
      if (msg.role === 'user') {
        lines.push(`**> ${msg.content}**`, '');
      } else if (msg.role === 'assistant') {
        lines.push(redactSecrets(msg.content), '');
        if (msg.sources?.length) {
          lines.push(`*Sources: ${msg.sources.join(', ')}*`, '');
        }
      } else {
        lines.push(`> ${redactSecrets(msg.content)}`, '');
      }
      lines.push('---', '');
    }

    writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    return outputPath;
  }, [sessionId, messages]);

  return {
    sessionId,
    messages,
    addMessage,
    setMessages,
    saveSession,
    saveSessionMeta,
    loadLastSession,
    exportSession,
  };
}
