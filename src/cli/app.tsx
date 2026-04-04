import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, Static, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { writeFileSync as wfs, readFileSync as rfs, unlinkSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { getTheme } from './theme.js';
import { Banner } from './components/Banner.js';
import { touchProfile, getWelcomeMessage } from './onboarding.js';
import { Message, type MessageData } from './components/Message.js';
import { BrowzySpinner } from './components/Spinner.js';
import { SuggestionList } from './components/Suggestions.js';
import { StatusBar } from './components/StatusBar.js';
import { renderMarkdown } from './components/Markdown.js';
import { useHistory } from './hooks/useHistory.js';
import { useAutocomplete } from './hooks/useAutocomplete.js';
import { useSession, loadSessionMeta, updateSessionMetaDigest } from './hooks/useSession.js';
import {
  updateStreak, recordSourceAdded, recordQuery, checkMilestones, loadStreak,
  getThinkingMessage, getIngestingMessage, getCompilingMessage, getHealthMessage,
  getAddReward, getQueryReward, getExitMessage, getHealthReward, computeReflection,
} from './personality.js';
import { getKey, saveKey, looksLikeApiKey } from './keystore.js';
import { loadConfig, ensureDataDirs, createProvider, tryCreateProvider, isOllamaRunning, classifyError, costTracker } from '../core/index.js';
import { seedDemoKB } from '../core/demo/seed.js';
import { ingest } from '../core/ingest/index.js';
import { WikiCompiler } from '../core/compile/index.js';
import { QueryEngine, buildLLMHistory } from '../core/query/index.js';
import { WikiLinter } from '../core/lint/index.js';
import { Wiki } from '../core/wiki/index.js';
import { compactConversation } from '../core/retrieval/index.js';
import { resolveGap } from '../core/discovery/index.js';
import { initClipboard, checkClipboardChange } from '../core/discovery/clipboard.js';
import { checkStaleSources } from '../core/discovery/freshness.js';
import { FilesystemStorage } from '../core/storage/filesystem.js';
import { QUERY_SYSTEM_PROMPT, CONVERSATION_CONTEXT_PROMPT, SESSION_DIGEST_PROMPT } from '../core/prompts.js';
import { generateSessionDigest } from '../core/query/digest.js';
import { crystallize } from '../core/query/crystallizer.js';
import type { BrowzyConfig, LintIssue } from '../core/types.js';
import type { LLMProvider } from '../core/llm/provider.js';
import type { OutputFormat } from '../core/query/index.js';

// ── Error Boundary ─────────────────────────────────────────────

interface ErrorBoundaryState { hasError: boolean; error?: Error }

export class BrowzyErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>browzy encountered an error:</Text>
          <Text color="red">{this.state.error?.message}</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function extractTopic(input: string): string {
  return input
    .replace(/\b(i'm |i am |i want to |can you |please |could you )/gi, '')
    .replace(/\b(interested in|learn about|dive into|explore|research)\b/gi, '')
    .trim()
    .replace(/[?.!]+$/, '')
    .trim();
}

// ── Main App ───────────────────────────────────────────────────
//
// Layout pattern from Claude Code:
// - <Static> for completed messages — renders once, NEVER re-renders
// - Dynamic section below for: streaming text, spinner, input, status
// This prevents re-render collapse during streaming.

export const BrowzyApp: React.FC = () => {
  const theme = getTheme();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;

  // Reset cost tracker at the start of each session
  useState(() => { costTracker.reset(); });

  // State
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('thinking...');
  const [elapsed, setElapsed] = useState(0);
  const [streamingText, setStreamingText] = useState('');
  const [tempStatus, setTempStatus] = useState('');
  const [stashedInput, setStashedInput] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState('');
  const [lastModelList, setLastModelList] = useState<Array<{ id: string; display_name: string }>>([]);
  const [lastModelProvider, setLastModelProvider] = useState<string>('');
  const [crystallizedThisSession, setCrystallizedThisSession] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('markdown');
  const [sessionGaps, setSessionGaps] = useState<string[]>([]);
  const [pendingDive, setPendingDive] = useState<{ topic: string; originalInput: string } | null>(null);
  const [costStatus, setCostStatus] = useState('');

  // Refs for input/loading (no forward-reference issues)
  const inputRef = useRef(input);
  inputRef.current = input;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // Hooks
  const history = useHistory();
  const autocomplete = useAutocomplete();
  const session = useSession();

  // Config + LLM (nullable — no API key on first run)
  const [config, setConfig] = useState<BrowzyConfig>(() => {
    const c = loadConfig();
    ensureDataDirs(c);
    return c;
  });

  // Seed demo KB on first run (before stats are loaded)
  const [demoSeeded] = useState(() => {
    try {
      return seedDemoKB(config.dataDir);
    } catch {
      return false;
    }
  });

  // LLM provider is null when no API key is configured (first run / demo mode)
  const [llm, setLlm] = useState<LLMProvider | null>(() => tryCreateProvider(config.llm));

  // Track whether we're waiting for an API key from the user
  const [awaitingApiKey, setAwaitingApiKey] = useState(false);
  // Store the pending query/command that triggered the API key prompt
  const pendingActionRef = useRef<{ type: 'query' | 'add'; value: string } | null>(null);

  // Set initial model name — #22: include config.llm.model in deps
  useEffect(() => { setCurrentModel(config.llm.model || 'default'); }, [config.llm.model]);

  // Stats — loaded synchronously so the banner has correct values on first render
  // #16/#26: Re-load stats AFTER seeding so banner shows post-seed values
  const [stats, setStats] = useState(() => {
    try {
      const wiki = new Wiki(config.dataDir);
      const s = wiki.stats();
      wiki.close();
      return s;
    } catch {
      return { sources: 0, articles: 0, concepts: 0 };
    }
  });

  // Refs — break dependency chains for callbacks (#1, #11, #21)
  const llmRef = useRef(llm);
  llmRef.current = llm;
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const outputFormatRef = useRef(outputFormat);
  outputFormatRef.current = outputFormat;
  const crystallizedRef = useRef(crystallizedThisSession);
  crystallizedRef.current = crystallizedThisSession;

  // Auto-detect Ollama on startup when no LLM provider is configured
  const ollamaCheckRanRef = useRef(false);
  useEffect(() => {
    if (ollamaCheckRanRef.current || llm) return;
    ollamaCheckRanRef.current = true;
    isOllamaRunning().then(async (running) => {
      if (running && !llmRef.current) {
        try {
          // Fetch installed models from Ollama
          const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
          const data = await resp.json() as any;
          const models: string[] = (data.models || []).map((m: any) => m.name || m.model).filter(Boolean);
          if (models.length === 0) return; // No models installed — skip auto-connect
          const selectedModel = models[0];
          const ollamaConfig = { provider: 'ollama' as const, apiKey: '', model: selectedModel };
          const provider = createProvider(ollamaConfig);
          setLlm(provider);
          llmRef.current = provider;
          setConfig(prev => ({ ...prev, llm: ollamaConfig }));
          setCurrentModel(`${selectedModel} (local)`);
          session.addMessage('system', `Detected local Ollama server — connected to ${selectedModel} (free, runs on your machine). Or paste an API key for Claude/GPT.`);
        } catch { /* Ollama detection failed silently */ }
      }
    }).catch(() => { /* Ollama not available */ });
  }, [llm]);

  // Snapshot stats at session start for exit reflection
  const statsAtStartRef = useRef(stats);
  const sessionGapsRef = useRef(sessionGaps);
  sessionGapsRef.current = sessionGaps;

  // Session memory — load last session meta and compute growth delta
  const [sessionMemory] = useState(() => {
    const meta = loadSessionMeta();
    if (!meta) return { digest: undefined, growthDelta: undefined };

    // Compute growth delta
    const growthDelta = {
      articles: stats.articles - meta.articleCount,
      sources: stats.sources - meta.sourceCount,
    };

    // Load digest if it exists
    let digest: string | undefined;
    if (meta.digestPath) {
      try {
        const { readFileSync, existsSync } = require('fs') as typeof import('fs');
        if (existsSync(meta.digestPath)) {
          digest = readFileSync(meta.digestPath, 'utf-8').trim();
        }
      } catch { /* ignore */ }
    }

    return { digest, growthDelta, meta };
  });

  // Generate digest for last session if it doesn't have one yet
  useEffect(() => {
    if (sessionMemory.meta && !sessionMemory.digest && llm) {
      const lastSession = session.loadLastSession();
      if (lastSession && lastSession.id === sessionMemory.meta.sessionId) {
        const userMessages = lastSession.messages.filter(m => m.role === 'user');
        if (userMessages.length >= 3) {
          // Generate digest in background — don't block startup
          generateSessionDigest(
            lastSession.messages.map(m => ({ role: m.role, content: m.content })),
            llm,
          ).then(digestText => {
            const { writeFileSync, mkdirSync } = require('fs') as typeof import('fs');
            const { join } = require('path') as typeof import('path');
            const { homedir } = require('os') as typeof import('os');
            const sessionsDir = join(homedir(), '.browzy', 'sessions');
            mkdirSync(sessionsDir, { recursive: true });

            // Save digest file
            const digestPath = join(sessionsDir, `${lastSession.id}-digest.txt`);
            writeFileSync(digestPath, digestText, 'utf-8');
            updateSessionMetaDigest(digestPath);

            // Save as wiki article
            const date = new Date().toISOString().slice(0, 10);
            try {
              const { FilesystemStorage } = require('../core/storage/filesystem.js');
              const fs = new FilesystemStorage(config.dataDir);
              fs.writeArticle(`session-${date}`, {
                title: `Session Digest — ${date}`,
                tags: ['session-digest'],
                summary: digestText.slice(0, 120),
                sources: [],
              }, digestText);
            } catch { /* wiki article is optional */ }
          }).catch(() => { /* digest generation failed, not critical */ });
        }
      }
    }
    // #3: re-run when LLM becomes available (e.g. after API key paste)
  }, [llm]);

  // Welcome & streak — computed once with stats available
  const [welcomeMsg] = useState(() => {
    if (demoSeeded) {
      return 'Welcome to browzy! I\'ve loaded some starter articles so you can explore right away. Try asking a question, use /search to browse, or paste a URL to add your own knowledge.';
    }
    updateStreak();
    const profile = touchProfile();
    return profile ? getWelcomeMessage(profile, stats) : 'Your knowledge, compiled.';
  });

  const refreshStats = useCallback(() => {
    try {
      const wiki = new Wiki(config.dataDir);
      setStats(wiki.stats());
      wiki.close();
    } catch { /* ignore */ }
  }, [config.dataDir]);

  // #24: removed redundant refreshStats effect — stats are already loaded synchronously in useState

  // Clipboard watcher — opt-in only
  useEffect(() => {
    if (!config.clipboard?.enabled) return;
    initClipboard().catch(() => {});

    // #12: filter sensitive data; #19: poll every 5s instead of 3s
    const sensitivePatterns = [/sk-ant-[a-zA-Z0-9\-_]{20,}/, /sk-[a-zA-Z0-9\-_]{48,}/, /sk-or-[a-zA-Z0-9\-_]{20,}/, /AKIA[A-Z0-9]{16}/, /^.{6,30}$/];
    const timer = setInterval(async () => {
      const newContent = await checkClipboardChange();
      if (newContent && llmRef.current) {
        // Skip content that looks like API keys or passwords
        const lines = newContent.trim().split('\n');
        const isSensitive = lines.length === 1 && sensitivePatterns.some(p => p.test(newContent.trim()));
        if (isSensitive) return;
        try {
          await ingest(newContent, config.dataDir, { llm: llmRef.current, type: 'text' });
          const preview = newContent.slice(0, 50).replace(/\n/g, ' ');
          setTempStatus(`+ Captured: "${preview}..."`);
          refreshStats();
        } catch { /* silently fail */ }
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [config.clipboard?.enabled, llm]);

  // Living Wiki — check for stale sources on startup (fire-and-forget)
  // #13: use ref-based stats to avoid stale closure, keep as mount-only
  const staleCheckRanRef = useRef(false);
  useEffect(() => {
    if (staleCheckRanRef.current) return;
    if (statsRef.current.sources === 0) return;
    staleCheckRanRef.current = true;

    const fsStorage = new FilesystemStorage(config.dataDir);
    const manifest = fsStorage.getRawManifest();

    checkStaleSources(manifest).then(stale => {
      if (stale.length > 0) {
        session.addMessage('system',
          `${stale.length} source${stale.length > 1 ? 's have' : ' has'} been updated since you last checked:\n` +
          stale.map(s => `  · "${s.title}" — ${s.reason}`).join('\n') +
          `\nType /refresh to update your browzy.`
        );
      }
    }).catch(() => {});
  }, [config.dataDir, session]);

  // Elapsed timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const start = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(timer);
  }, [loading]);

  // Save session + meta on unmount AND on process signals
  // React cleanup only runs if the framework has time to unmount.
  // Terminal close (SIGTERM/SIGHUP) and Ctrl+C (SIGINT) kill the process
  // before React cleans up, so we need process-level handlers too.
  const reflectionShownRef = useRef(false);
  const showReflection = useCallback(() => {
    if (reflectionShownRef.current) return;
    reflectionShownRef.current = true;
    const reflection = computeReflection(
      session.messages,
      statsAtStartRef.current,
      stats,
      sessionGapsRef.current,
    );
    if (reflection) {
      console.log('\n── Session Reflection ──────────────────────');
      console.log(reflection);
      console.log('────────────────────────────────────────────\n');
    }
  }, [session.messages, stats]);

  const savedRef = useRef(false);
  const saveOnce = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    showReflection();
    session.saveSession();
    session.saveSessionMeta(stats);
  }, [session, stats, showReflection]);

  // #2: separate unmount-only effect for saving (no saveOnce in cleanup of signal effect)
  // #7: use exit() from Ink instead of process.exit(0) to avoid leaving terminal in raw mode
  const saveOnceRef = useRef(saveOnce);
  saveOnceRef.current = saveOnce;

  useEffect(() => {
    const handler = () => { saveOnceRef.current(); exit(); };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    process.on('SIGHUP', handler);
    return () => {
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      process.removeListener('SIGHUP', handler);
    };
  }, []); // stable — reads from ref

  // Unmount-only save
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (!unmountedRef.current) {
        unmountedRef.current = true;
        saveOnceRef.current();
      }
    };
  }, []);

  // ── Streaming with throttle ─────────────────────────────────

  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSnapshotRef = useRef('');

  // Helper: prompt for API key inline when LLM is needed
  // #1: use llmRef to avoid stale closure
  const requireLlm = useCallback((action: { type: 'query' | 'add'; value: string }): boolean => {
    if (llmRef.current) return true;
    pendingActionRef.current = action;
    setAwaitingApiKey(true);
    session.addMessage('system', [
      'To ' + (action.type === 'query' ? 'answer questions' : 'add sources') + ', I need an LLM.',
      '',
      'Options:',
      '  1. Install Ollama for free local inference: ollama.com (run "ollama serve")',
      '  2. Paste your Anthropic API key (starts with sk-ant-...)',
      '  3. Or paste an OpenAI key (sk-...) or OpenRouter key (sk-or-...).',
      '',
      'Get a Claude key at: console.anthropic.com/settings/keys',
    ].join('\n'));
    return false;
  }, [session]);

  const handleQuery = useCallback(async (question: string) => {
    if (!requireLlm({ type: 'query', value: question })) return;
    const currentLlm = llmRef.current!; // #1: read from ref, guaranteed non-null after requireLlm
    session.addMessage('user', question);
    recordQuery();
    setLoading(true);
    setLoadingLabel(getThinkingMessage());
    setStreamingText('');
    latestSnapshotRef.current = '';

    try {
      // Build context + prompt (no LLM call yet)
      const engine = new QueryEngine(config.dataDir, currentLlm);
      const prepared = engine.prepare(question, { format: outputFormatRef.current }); // #11: use ref

      // #6: Single LLM call — stream directly with the prepared context (no double call)
      let finalText = '';
      // #17: smart history — filters system messages, uses token-aware truncation
      const recentHistory = buildLLMHistory(session.messages);
      const systemPrompt = prepared.systemPrompt + '\n\n' + CONVERSATION_CONTEXT_PROMPT;
      try {

        for await (const chunk of currentLlm.stream(
          [...recentHistory, { role: 'user' as const, content: prepared.prompt }],
          { system: systemPrompt, maxTokens: 8192 }
        )) {
          latestSnapshotRef.current = chunk.snapshot;
          finalText = chunk.snapshot;

          if (!streamThrottleRef.current) {
            streamThrottleRef.current = setTimeout(() => {
              setStreamingText(latestSnapshotRef.current);
              streamThrottleRef.current = null;
            }, 250);
          }
        }
        // Estimate tokens for streaming (no usage returned from stream API)
        // Rough estimate: ~4 chars per token
        const historyChars = recentHistory.reduce((s, m) => s + m.content.length, 0);
        const estInput = Math.ceil((systemPrompt.length + prepared.prompt.length + historyChars) / 4);
        const estOutput = Math.ceil(finalText.length / 4);
        costTracker.recordQuery(config.llm.model || 'claude-sonnet-4', { inputTokens: estInput, outputTokens: estOutput });
        setCostStatus(costTracker.formatStatus());
      } catch {
        // Fallback: non-streaming call — include conversation history
        const response = await currentLlm.chat(
          [...recentHistory, { role: 'user', content: prepared.prompt }],
          { system: prepared.systemPrompt, maxTokens: 8192 }
        );
        finalText = response.content;
        if (response.usage) {
          costTracker.recordQuery(config.llm.model || 'claude-sonnet-4', response.usage);
          setCostStatus(costTracker.formatStatus());
        }
      }

      // Build a result object for downstream consumers (crystallizer, gaps, etc.)
      const fullResult = {
        answer: finalText,
        sourcesUsed: prepared.sourcesUsed,
        confidence: prepared.confidence,
        gaps: prepared.gaps,
      };

      // Clear throttle
      if (streamThrottleRef.current) {
        clearTimeout(streamThrottleRef.current);
        streamThrottleRef.current = null;
      }

      setStreamingText('');
      session.addMessage('assistant', finalText, fullResult.sourcesUsed);

      // #5: Insight Crystallizer — use ref to prevent race condition
      if (!crystallizedRef.current && fullResult.sourcesUsed.length >= 2) {
        crystallizedRef.current = true; // set synchronously before async call
        try {
          const wikiForCrystal = new Wiki(config.dataDir);
          const sourceContents = fullResult.sourcesUsed.slice(0, 5).map(slug => {
            const article = wikiForCrystal.getArticle(slug);
            return article ? { slug, content: article.content } : null;
          }).filter(Boolean) as Array<{ slug: string; content: string }>;
          wikiForCrystal.close();

          if (sourceContents.length >= 2) {
            crystallize(question, finalText, fullResult.sourcesUsed, sourceContents, config.dataDir, currentLlm)
              .then(result => {
                if (result.saved) {
                  setCrystallizedThisSession(true);
                  setTempStatus(prev => prev ? `${prev} · insight drafted` : 'insight drafted');
                } else {
                  crystallizedRef.current = false; // reset if not saved
                }
              })
              .catch(() => {
                // #14: catch SQLITE_BUSY or other write errors
                crystallizedRef.current = false;
              });
          } else {
            crystallizedRef.current = false; // reset if not enough sources
          }
        } catch {
          crystallizedRef.current = false;
        }
      }

      // Accumulate gaps for session reflection
      if (fullResult.gaps && fullResult.gaps.length > 0) {
        setSessionGaps(prev => [...prev, ...fullResult.gaps]);
      }

      // Show confidence + gaps
      const rewardParts = [getQueryReward(fullResult.sourcesUsed.length)];
      if (fullResult.confidence === 'low') {
        rewardParts.push('Coverage is thin on this topic.');
      }
      if (fullResult.gaps && fullResult.gaps.length > 0) {
        rewardParts.push(`Try /add to cover: ${fullResult.gaps.join(', ')}`);
      }
      setTempStatus(rewardParts.filter(Boolean).join(' '));

      // Gap Hunter: fire-and-forget resolution for the first gap
      if (fullResult.gaps && fullResult.gaps.length > 0) {
        resolveGap(fullResult.gaps[0]).then(suggestion => {
          if (suggestion && !loadingRef.current) {
            session.addMessage('system', `Gap: "${fullResult.gaps[0]}" — found "${suggestion.title}" (${suggestion.url}). Type /add ${suggestion.url} to fill this gap.`);
          }
        }).catch(() => { /* silently ignore */ });
      }

      // Check for milestones — #11: use ref for stats
      const milestone = checkMilestones(statsRef.current);
      if (milestone) session.addMessage('system', milestone);

      // #10: Auto-compact for LLM context only — don't replace displayed messages
      // Track compacted context separately, keeping displayed messages intact
      if (session.messages.length > 20 && currentLlm) {
        try {
          await compactConversation(
            session.messages.map(m => ({ role: m.role, content: m.content })),
            currentLlm,
            6,
          );
          // Compaction result is used internally for LLM context in future queries.
          // Displayed messages in <Static> are NOT replaced.
        } catch { /* compaction failed, continue with full history */ }
      }
    } catch (err: any) {
      setStreamingText('');
      const classified = classifyError(err);
      session.addMessage('system', classified.userMessage);
      if (classified.action === 'reprompt_key') {
        setLlm(null);
        llmRef.current = null;
      }
    }

    setLoading(false);
    refreshStats();
  }, [config, session, refreshStats, requireLlm]);

  // ── Commands ────────────────────────────────────────────────

  const handleCommand = useCallback(async (cmdInput: string) => {
    const parts = cmdInput.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/add': {
        if (!args) { session.addMessage('system', 'Drop a URL or file path after /add. Drag files into the terminal to paste their paths.'); return; }
        if (!requireLlm({ type: 'add', value: args })) return;

        let sources: string[];
        if (args.startsWith('--from ')) {
          const filePath = args.replace('--from ', '').trim();
          try {
            const content = rfs(filePath, 'utf-8');
            const rawLines = content.split('\n').map(l => l.trim().replace(/^\d+\.\s*/, '')).filter(l => l && !l.startsWith('#'));
            // Validate each line looks like a URL or file path
            sources = rawLines.flatMap(l => parseMultipleSources(l)).filter(Boolean);
            if (sources.length === 0 && rawLines.length > 0) {
              session.addMessage('system', `${filePath} contains ${rawLines.length} line(s) but none look like URLs or file paths.`);
              return;
            }
            session.addMessage('system', `Reading ${filePath}... ${sources.length} source${sources.length !== 1 ? 's' : ''} found.`);
          } catch (err: any) {
            session.addMessage('system', `Can't read ${filePath}: ${err.message}`);
            return;
          }
        } else {
          sources = parseMultipleSources(args);
        }

        if (sources.length === 0) { session.addMessage('system', 'No valid sources found. Use URLs or file paths.'); return; }

        setLoading(true);
        const total = sources.length;
        if (total > 1) session.addMessage('system', `Ingesting ${total} sources...`);
        const addedTitles: string[] = [];

        for (let i = 0; i < total; i++) {
          setLoadingLabel(`Ingesting (${i + 1}/${total})...`);
          try {
            const result = await ingest(sources[i], config.dataDir, { llm: llmRef.current! });
            addedTitles.push(result.title);
            recordSourceAdded();
            session.addMessage('system', `✓ [${i + 1}/${total}] "${result.title}"`);
          } catch (err: any) {
            session.addMessage('system', `✗ [${i + 1}/${total}] Failed: ${err.message}`);
          }
        }

        setLoadingLabel(getCompilingMessage());
        let created = 0, updated = 0;
        try {
          const compiler = new WikiCompiler(config.dataDir, llmRef.current!);
          const result = await compiler.compile({
            batchSize: config.compile.batchSize,
            extractConcepts: config.compile.extractConcepts,
            onProgress: (cur, tot, title) => setLoadingLabel(`Compiling (${cur}/${tot}): ${title.slice(0, 40)}...`),
          });
          created = result.articlesCreated.length;
          updated = result.articlesUpdated.length;
        } catch (err: any) {
          session.addMessage('system', `Compile hiccup: ${err.message}`);
        }
        setLoading(false);
        refreshStats();

        // Playful reward
        const displayTitle = addedTitles.length === 1 ? addedTitles[0] : `${addedTitles.length} sources`;
        if (addedTitles.length > 0 || created > 0 || updated > 0) {
          const reward = getAddReward(displayTitle, created, updated, stats.articles + created);
          if (reward) session.addMessage('system', reward);
        }

        // Check milestones
        const milestone = checkMilestones({ ...stats, articles: stats.articles + created });
        if (milestone) session.addMessage('system', milestone);

        setTempStatus(`+${sources.length} source${sources.length > 1 ? 's' : ''}`);
        break;
      }
      case '/health': {
        // #4: guard against null LLM
        if (!requireLlm({ type: 'query', value: '/health' })) return;
        setLoading(true); setLoadingLabel(getHealthMessage()); refreshStats();
        try {
          const linter = new WikiLinter(config.dataDir, llmRef.current!);
          const issues = await linter.lint();
          const e = issues.filter((i: LintIssue) => i.severity === 'error').length;
          const w = issues.filter((i: LintIssue) => i.severity === 'warning').length;
          const s = issues.filter((i: LintIssue) => i.severity === 'suggestion').length;

          if (issues.length > 0) {
            const txt = issues.map((i: LintIssue) => `  ${i.severity === 'error' ? '✗' : i.severity === 'warning' ? '!' : '·'} [${i.article}] ${i.message}`).join('\n');
            session.addMessage('system', txt);
          }
          session.addMessage('system', getHealthReward(e, w, s));
        } catch (err: any) { session.addMessage('system', `Health check failed: ${err.message}`); }
        setLoading(false); break;
      }
      case '/rebuild': {
        if (!requireLlm({ type: 'add', value: '' })) return;
        setLoading(true); setLoadingLabel(getCompilingMessage());
        try {
          const compiler = new WikiCompiler(config.dataDir, llmRef.current!);
          const r = await compiler.compile({
            batchSize: config.compile.batchSize,
            extractConcepts: config.compile.extractConcepts,
            onProgress: (cur, tot, title) => setLoadingLabel(`Compiling (${cur}/${tot}): ${title.slice(0, 40)}...`),
          });
          const total = r.articlesCreated.length + r.articlesUpdated.length;
          session.addMessage('system', total === 0
            ? 'Your browzy is up to date. Nothing to rebuild.'
            : `Rebuilt: ${r.articlesCreated.length} new, ${r.articlesUpdated.length} updated. Your browzy just got sharper.`);
        } catch (err: any) { session.addMessage('system', `Rebuild hit a snag: ${err.message}`); }
        setLoading(false); refreshStats(); break;
      }
      case '/model': {
        const switchTo = (provider: 'claude' | 'openai' | 'openrouter' | 'ollama', modelId: string, apiKey: string, displayName?: string) => {
          const newLlmConfig = { provider, model: modelId, apiKey };
          const newConfig = { ...config, llm: newLlmConfig };
          setConfig(newConfig);
          setLlm(createProvider(newLlmConfig));
          setCurrentModel(displayName || modelId);
          session.addMessage('system', `Switched to ${displayName || modelId}. Let's see what this one can do.`);
        };

        if (args) {
          // /model <number> — pick from last fetched list
          const num = parseInt(args, 10);
          if (!isNaN(num) && num >= 1 && num <= lastModelList.length) {
            const picked = lastModelList[num - 1];
            // Determine provider from model ID (use tracked provider for Ollama)
            const provider = lastModelProvider === 'ollama' ? 'ollama' as const
              : picked.id.startsWith('claude') ? 'claude' as const
              : picked.id.includes('/') ? 'openrouter' as const
              : 'openai' as const;
            const apiKey = provider === 'ollama' ? ''
              : provider === 'claude' ? (getKey('anthropic') || config.llm.apiKey)
              : provider === 'openrouter' ? (getKey('openrouter') || config.llm.apiKey)
              : (getKey('openai') || config.llm.apiKey);
            switchTo(provider, picked.id, apiKey, picked.display_name);
          }
          // /model claude — show Claude models
          else if (args === 'claude') {
            await fetchAndShowModels('claude');
          }
          // /model openrouter — show OpenRouter models
          else if (args === 'openrouter') {
            await fetchAndShowModels('openrouter');
          }
          // /model openai — show OpenAI models
          else if (args === 'openai') {
            await fetchAndShowModels('openai');
          }
          // /model ollama — show/connect Ollama models
          else if (args === 'ollama') {
            await fetchAndShowModels('ollama');
          }
          // /model <exact-model-id> — direct switch
          else {
            const provider = args.startsWith('claude') ? 'claude' as const
              : args.includes('/') ? 'openrouter' as const
              : 'openai' as const;
            const apiKey = provider === 'claude' ? (getKey('anthropic') || config.llm.apiKey)
              : provider === 'openrouter' ? (getKey('openrouter') || config.llm.apiKey)
              : (getKey('openai') || config.llm.apiKey);
            if (!apiKey) {
              const envVar = provider === 'claude' ? 'ANTHROPIC_API_KEY' : provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
              session.addMessage('system', `No API key for ${provider}. Set ${envVar} in your environment:\n\n  export ${envVar}=your-key-here\n\nThen restart browzy.`);
            } else {
              switchTo(provider, args, apiKey);
            }
          }
        } else {
          // /model — show menu of providers
          const hasAnthropic = !!(getKey('anthropic') || config.llm.apiKey);
          const hasOpenRouter = !!getKey('openrouter');
          const hasOpenAI = !!getKey('openai');

          const lines = [
            'Choose a provider:',
            '',
            hasAnthropic ? '  /model claude       Browse Claude models' : '  /model claude       Paste your API key to enable',
            hasOpenRouter ? '  /model openrouter   Browse 200+ models (GPT, Gemini, Llama, Mistral...)' : '  /model openrouter   Paste your API key to enable (openrouter.ai)',
            hasOpenAI ? '  /model openai       Browse OpenAI models' : '  /model openai       Paste your API key to enable',
            '  /model ollama       Use local Ollama models (free, no API key needed)',
            '',
            `  Current: ${currentModel}`,
          ];
          session.addMessage('system', lines.join('\n'));
        }

        async function fetchAndShowModels(provider: string) {
          setLoading(true);
          setLoadingLabel('Fetching models...');
          try {
            let models: Array<{ id: string; display_name: string }> = [];

            if (provider === 'claude') {
              const key = getKey('anthropic') || config.llm.apiKey;
              if (!key) { session.addMessage('system', 'No Claude API key found. Paste your key below — it starts with sk-ant-...\nGet one at console.anthropic.com/settings/keys'); setLoading(false); return; }
              const { default: Anthropic } = await import('@anthropic-ai/sdk');
              const client = new Anthropic({ apiKey: key });
              const page = await client.models.list({ limit: 50 });
              models = page.data
                .filter((m: { id: string }) => m.id.startsWith('claude'))
                .sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))
                .map((m: { id: string; display_name: string }) => ({ id: m.id, display_name: m.display_name }));
            }

            else if (provider === 'openrouter') {
              const key = getKey('openrouter');
              if (!key) { session.addMessage('system', 'No OpenRouter API key found. Paste your key below — it starts with sk-or-...\nGet one at openrouter.ai/keys'); setLoading(false); return; }
              const resp = await fetch('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${key}` },
              });
              const data = await resp.json() as { data: Array<{ id: string; name: string; pricing?: { prompt?: string } }> };
              // Sort by popularity (cheapest per-token models tend to be most popular/used)
              // Filter to major providers, sort by name for clean grouping
              const majorProviders = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'deepseek', 'cohere', 'qwen'];
              models = data.data
                .filter((m: { id: string }) => majorProviders.some(p => m.id.startsWith(p + '/')))
                .filter((m: { id: string }) => !m.id.includes('free') && !m.id.includes('extended'))
                .sort((a, b) => {
                  // Sort by provider group, then by name
                  const aProvider = a.id.split('/')[0];
                  const bProvider = b.id.split('/')[0];
                  const providerOrder = majorProviders.indexOf(aProvider) - majorProviders.indexOf(bProvider);
                  if (providerOrder !== 0) return providerOrder;
                  return a.name.localeCompare(b.name);
                })
                .slice(0, 30)
                .map((m: { id: string; name: string }) => ({ id: m.id, display_name: m.name }));
            }

            else if (provider === 'openai') {
              const key = getKey('openai');
              if (!key) { session.addMessage('system', 'No OpenAI API key found. Paste your key below — it starts with sk-...\nGet one at platform.openai.com/api-keys'); setLoading(false); return; }
              const { default: OpenAI } = await import('openai');
              const client = new OpenAI({ apiKey: key });
              const list = await client.models.list();
              // Only chat models, exclude realtime/image/audio/embedding/legacy
              const excludePatterns = ['realtime', 'image', 'audio', 'tts', 'whisper', 'dall-e', 'embedding', 'moderation', 'babbage', 'davinci', 'search', 'instruct', 'similarity', 'code-'];
              models = Array.from(list.data)
                .filter((m: { id: string }) =>
                  (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4') || m.id.startsWith('chatgpt')) &&
                  !excludePatterns.some(p => m.id.includes(p))
                )
                // Sort by created date (newest first)
                .sort((a: { id: string; created: number }, b: { id: string; created: number }) => (b.created || 0) - (a.created || 0))
                .slice(0, 15)
                .map((m: { id: string }) => ({ id: m.id, display_name: m.id }));
            }

            else if (provider === 'ollama') {
              const running = await isOllamaRunning();
              if (!running) {
                session.addMessage('system', 'Ollama is not running. Start it with:\n\n  ollama serve\n\nInstall from ollama.com if needed.');
                setLoading(false); return;
              }
              try {
                const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
                const data = await resp.json() as { models?: Array<{ name: string; size: number }> };
                models = (data.models || []).map(m => ({ id: m.name, display_name: `${m.name} (${(m.size / 1e9).toFixed(1)}GB)` }));
                if (models.length === 0) {
                  session.addMessage('system', 'No models installed in Ollama. Pull one with:\n\n  ollama pull llama3.2\n  ollama pull mistral\n  ollama pull qwen2.5');
                  setLoading(false); return;
                }
              } catch {
                session.addMessage('system', 'Could not fetch Ollama models.');
                setLoading(false); return;
              }
            }

            setLastModelList(models);
            setLastModelProvider(provider);

            if (models.length === 0) {
              session.addMessage('system', 'No models found. Check your API key.');
            } else {
              const lines = models.map((m, i) => {
                const marker = m.id === currentModel ? ' (current)' : '';
                return `  [${i + 1}] ${m.display_name}${m.display_name !== m.id ? ` — ${m.id}` : ''}${marker}`;
              });
              session.addMessage('system', `${provider} models:\n${lines.join('\n')}\n\nType /model <number> to switch.`);
            }
          } catch (err: any) {
            session.addMessage('system', `Couldn't fetch models: ${err.message}`);
          }
          setLoading(false);
        }

        break;
      }
      case '/export': {
        // #18: prevent path traversal — resolve and verify within output dir
        const outputDir = join(config.dataDir, 'output');
        const safe = (args || `session-${session.sessionId}.md`).replace(/[^\w\-./]/g, '_');
        const resolvedPath = resolve(outputDir, safe);
        if (!resolvedPath.startsWith(resolve(outputDir))) {
          session.addMessage('system', 'Invalid export path.'); break;
        }
        const exportedPath = session.exportSession(resolvedPath);
        session.addMessage('system', `Saved to ${exportedPath}. Your research, preserved.`); break;
      }
      case '/search': {
        if (!args) { session.addMessage('system', 'Usage: /search <term>'); break; }
        try {
          const wiki = new Wiki(config.dataDir);
          const results = wiki.search(args, 10);
          wiki.close();
          if (results.length === 0) {
            session.addMessage('system', `No articles matching "${args}".`);
          } else {
            const formatted = results.map((r, i) =>
              `  ${i + 1}. [[${r.slug}]] — ${r.title}\n     ${r.snippet || ''}`
            ).join('\n');
            session.addMessage('system', `Found ${results.length} articles:\n${formatted}`);
          }
        } catch (err: any) {
          session.addMessage('system', `Search error: ${err.message}`);
        }
        break;
      }
      case '/format': {
        if (!args) {
          session.addMessage('system', `Current format: ${outputFormat}. Options: markdown, marp, json`);
          break;
        }
        const fmt = args.toLowerCase().trim();
        if (['markdown', 'marp', 'json'].includes(fmt)) {
          setOutputFormat(fmt as OutputFormat);
          session.addMessage('system', `Output format set to: ${fmt}`);
        } else {
          session.addMessage('system', `Unknown format "${fmt}". Options: markdown, marp, json`);
        }
        break;
      }
      case '/copy': {
        const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
        if (!lastAssistant) {
          session.addMessage('system', 'Nothing to copy — ask a question first.');
          break;
        }
        try {
          const platform = process.platform;
          if (platform === 'darwin') {
            execSync('pbcopy', { input: lastAssistant.content });
          } else if (platform === 'win32') {
            execSync('clip', { input: lastAssistant.content });
          } else {
            // Linux — try xclip, then xsel
            try {
              execSync('xclip -selection clipboard', { input: lastAssistant.content });
            } catch {
              execSync('xsel --clipboard --input', { input: lastAssistant.content });
            }
          }
          session.addMessage('system', 'Copied to clipboard.');
        } catch {
          session.addMessage('system', 'Could not copy — clipboard tool not found. Install xclip (Linux) or try manually.');
        }
        break;
      }
      case '/refresh': {
        if (!requireLlm({ type: 'add', value: '' })) return;
        setLoading(true);
        setLoadingLabel('Refreshing sources...');
        try {
          const fsStorage = new FilesystemStorage(config.dataDir);
          const manifest = fsStorage.getRawManifest();
          const stale = await checkStaleSources(manifest);

          if (stale.length === 0) {
            session.addMessage('system', 'Everything is up to date.');
          } else {
            for (const source of stale) {
              try {
                await ingest(source.origin, config.dataDir, { llm: llmRef.current! });
                session.addMessage('system', `✓ Refreshed: ${source.title}`);
              } catch (err: any) {
                session.addMessage('system', `✗ ${source.title}: ${err.message}`);
              }
            }
            // Recompile
            setLoadingLabel('Recompiling...');
            const compiler = new WikiCompiler(config.dataDir, llmRef.current!);
            await compiler.compile({
              batchSize: config.compile.batchSize,
              onProgress: (cur, tot, title) => setLoadingLabel(`Recompiling (${cur}/${tot}): ${title.slice(0, 40)}...`),
            });
          }
        } catch (err: any) {
          session.addMessage('system', `Refresh error: ${err.message}`);
        }
        setLoading(false);
        refreshStats();
        break;
      }
      case '/help':
        session.addMessage('system', [
          'Just type a question — your browzy will find the answer.',
          '',
          '/add <sources...>     Feed your browzy (URLs, PDFs, images, .md, .txt)',
          '                      Supports: multiple URLs, --from <file.txt>',
          '/search <term>        Find articles in your browzy',
          '/format <type>        Output format: markdown, marp, json',
          '/copy                 Copy last answer to clipboard',
          '/health               How is your browzy doing?',
          '/model <provider>     Switch LLM model',
          '/refresh              Re-fetch stale web sources',
          '/export               Save session to file',
          '/rebuild              Force recompilation',
          '/clear                Clear conversation',
          '/help                 Show this help',
          '',
          'Keys: Tab complete · ↑↓ history · Ctrl+E editor · Ctrl+S stash',
        ].join('\n'));
        break;
      case '/quit': case '/exit': case '/q':
        // #15: add exit message BEFORE saving; #9: use saveOnce for full save (session + meta)
        session.addMessage('system', getExitMessage(loadStreak()));
        saveOnce();
        setTimeout(() => exit(), 300); // Brief pause so they see the exit message
        break;
      // #20: handle /clear command
      case '/clear':
        session.setMessages([]);
        setTempStatus('Conversation cleared.');
        break;
      default: session.addMessage('system', `Hmm, I don't know "${cmd}". Type /help to see what I can do.`);
    }
  }, [config, session, refreshStats, handleQuery, exit, requireLlm, saveOnce]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();

    // #8: check pendingDive BEFORE empty-input return so Enter confirms dive
    if (pendingDive) {
      setInput('');
      autocomplete.setVisible(false);
      const answer = trimmed.toLowerCase();
      if (answer === 'n' || answer === 'no') {
        const orig = pendingDive.originalInput;
        setPendingDive(null);
        handleQuery(orig);
        return;
      }
      if (answer === 'y' || answer === 'yes' || answer === '') {
        if (!requireLlm({ type: 'add', value: '' })) return;
        const topic = pendingDive.topic;
        setPendingDive(null);
        setLoading(true);
        setLoadingLabel(`Searching for sources on "${topic}"...`);

        try {
          const { searchWeb } = await import('../core/discovery/webSearch.js');
          const queries = [
            `${topic} overview`,
            `${topic} explained`,
            `${topic} fundamentals`,
          ];

          const urls: Array<{ url: string; title: string }> = [];
          for (const q of queries) {
            if (urls.length >= 3) break;
            const result = await searchWeb(q);
            if (result && !urls.some(u => u.url === result.url)) {
              urls.push({ url: result.url, title: result.title });
            }
          }

          if (urls.length === 0) {
            session.addMessage('system', `Couldn't find good sources for "${topic}". Try pasting a specific URL.`);
            setLoading(false);
            return;
          }

          // Show what we found
          session.addMessage('system',
            `Found ${urls.length} sources:\n` +
            urls.map((u, i) => `  ${i + 1}. ${u.title} (${new URL(u.url).hostname})`).join('\n')
          );

          // Ingest each
          setLoadingLabel('Ingesting sources...');
          for (const u of urls) {
            try {
              const result = await ingest(u.url, config.dataDir, { llm: llmRef.current! });
              session.addMessage('system', `Done: ${result.title}`);
            } catch (err: any) {
              session.addMessage('system', `Failed: ${u.title}: ${err.message}`);
            }
          }

          // Compile
          setLoadingLabel('Compiling knowledge...');
          const compiler = new WikiCompiler(config.dataDir, llmRef.current!);
          await compiler.compile({ batchSize: config.compile.batchSize });

          setLoading(false);
          refreshStats();

          session.addMessage('system', `Your browzy is now loaded on "${topic}". Ask me anything.`);

        } catch (err: any) {
          session.addMessage('system', `Dive error: ${err.message}`);
          setLoading(false);
        }
        return;
      }
      // User typed something else — cancel dive and process as normal input
      setPendingDive(null);
      // Fall through to normal input handling below
    }

    if (!trimmed) return;

    setInput('');
    autocomplete.setVisible(false);

    // Detect pasted API keys — save them and create LLM provider
    const keyDetect = looksLikeApiKey(trimmed);
    if (keyDetect) {
      saveKey(keyDetect.provider, keyDetect.key);
      const names = { anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter' };

      // Create LLM provider with the new key
      const providerMap = { anthropic: 'claude' as const, openai: 'openai' as const, openrouter: 'openrouter' as const };
      const newLlmConfig = { ...config.llm, provider: providerMap[keyDetect.provider], apiKey: keyDetect.key };
      let newProvider: LLMProvider | null = null;
      try {
        newProvider = createProvider(newLlmConfig);
        setLlm(newProvider);
        llmRef.current = newProvider; // #1: update ref synchronously so replay reads correct value
        setConfig(prev => ({ ...prev, llm: newLlmConfig }));
        setCurrentModel(newLlmConfig.model || 'claude-sonnet-4-20250514');
      } catch { /* provider creation failed — key might be invalid, saved anyway */ }

      // If we were awaiting an API key, replay the pending action
      if (awaitingApiKey && pendingActionRef.current && newProvider) {
        setAwaitingApiKey(false);
        const pending = pendingActionRef.current;
        pendingActionRef.current = null;

        session.addMessage('system', `${names[keyDetect.provider]} API key saved. Continuing...`);

        // #1: replay immediately — llmRef is already updated, no stale closure
        setTimeout(async () => {
          if (pending.type === 'query') {
            await handleQuery(pending.value);
          } else if (pending.type === 'add') {
            await handleCommand(`/add ${pending.value}`);
          }
        }, 50);
        return;
      }

      session.addMessage('system', [
        `${names[keyDetect.provider]} API key saved.`,
        '',
        `Stored locally at ~/.browzy/keys.json on your machine only.`,
        `browzy is fully local — your keys never leave your device,`,
        `never touch our servers, and are never sent anywhere except`,
        `directly to ${names[keyDetect.provider]}'s API when you ask a question.`,
        '',
        `Try /model ${keyDetect.provider === 'anthropic' ? 'claude' : keyDetect.provider} to browse models.`,
      ].join('\n'));
      return;
    }

    history.addToHistory(trimmed);

    // Intent: URL auto-detect — paste a URL, browzy ingests automatically
    if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) {
      await handleCommand(`/add ${trimmed}`);
      return;
    }

    // Intent: File path auto-detect
    if (/^(\/|~\/|\.\/|\.\.\/)/.test(trimmed) && /\.(pdf|md|txt|png|jpg|jpeg|gif|webp)$/i.test(trimmed)) {
      await handleCommand(`/add ${trimmed}`);
      return;
    }

    // Intent: Topic exploration — auto-dive with confirmation
    const isTopicExplore = /\b(interested in|learn about|dive into|explore|research)\b/i.test(trimmed);
    if (isTopicExplore) {
      const topic = extractTopic(trimmed);
      if (topic.length > 2) {
        const wiki = new Wiki(config.dataDir);
        const coverage = wiki.search(topic, 3);
        wiki.close();

        if (coverage.length < 2) {
          session.addMessage('system',
            `Your browzy doesn't have much on "${topic}". Want me to find sources? (y/Enter = yes, n = skip)`
          );
          setPendingDive({ topic, originalInput: trimmed });
          return;
        }
      }
      // Good coverage or short topic — treat as Q&A
      handleQuery(trimmed);
      return;
    }

    let normalized = trimmed.replace(/^browzy\s+/i, '');
    const cmds = ['add', 'search', 'format', 'copy', 'health', 'rebuild', 'refresh', 'model', 'export', 'help', 'quit', 'exit', 'q', 'clear'];
    const first = normalized.split(/\s+/)[0].toLowerCase().replace(/^\//, '');
    if (cmds.includes(first)) normalized = '/' + (normalized.startsWith('/') ? normalized.slice(1) : normalized);

    if (normalized.startsWith('/')) await handleCommand(normalized);
    else await handleQuery(normalized);
  // #21: use refs for frequently-changing values to break dependency cascade
  }, [autocomplete, history, handleCommand, handleQuery, awaitingApiKey, config, session, pendingDive, requireLlm, refreshStats]);

  // ── Keyboard ────────────────────────────────────────────────

  useInput((ch, key) => {
    if (loadingRef.current) return;

    if (key.ctrl && ch === 'c') {
      if (inputRef.current) setInput('');
      else { saveOnceRef.current(); setTimeout(() => exit(), 50); } // #9: use saveOnce (includes meta)
      return;
    }
    if (key.ctrl && ch === 'd') { saveOnceRef.current(); setTimeout(() => exit(), 50); return; } // #9: use saveOnce
    if (key.ctrl && ch === 'e') { handleOpenEditor(); return; }
    if (key.ctrl && ch === 's') {
      if (inputRef.current.trim()) { setStashedInput(inputRef.current); setInput(''); setTempStatus('Stashed'); }
      else if (stashedInput) { setInput(stashedInput); setStashedInput(null); setTempStatus('Restored'); }
      return;
    }
    if (key.rightArrow && autocomplete.getGhostText(inputRef.current)) {
      const a = autocomplete.acceptSuggestion(inputRef.current); if (a) setInput(a); return;
    }
    if (key.upArrow && autocomplete.visible) { autocomplete.moveSelection('up', inputRef.current); return; }
    if (key.downArrow && autocomplete.visible) { autocomplete.moveSelection('down', inputRef.current); return; }
    if (key.upArrow) { const p = history.navigateHistory('up', inputRef.current); if (p !== null) setInput(p); return; }
    if (key.downArrow) { const n = history.navigateHistory('down', inputRef.current); if (n !== null) setInput(n); return; }
    if (key.tab) { const a = autocomplete.acceptSuggestion(inputRef.current); if (a) setInput(a); return; }
    if (key.escape) {
      if (autocomplete.visible) autocomplete.setVisible(false);
      else if (stashedInput) { setInput(stashedInput); setStashedInput(null); }
      return;
    }
  });

  const handleOpenEditor = () => {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
    const tmp = join(tmpdir(), `browzy-edit-${Date.now()}.txt`);
    wfs(tmp, inputRef.current, 'utf-8');
    // #25: use execFileSync to avoid shell injection from $EDITOR
    try { execFileSync(editor, [tmp], { stdio: 'inherit' }); const r = rfs(tmp, 'utf-8').trim(); if (r) setInput(r); }
    catch { /* cancelled */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
  };

  // #23: add autocomplete to dependency array
  useEffect(() => { autocomplete.updateForInput(input); }, [input, autocomplete]);

  // ── Render ──────────────────────────────────────────────────
  //
  // KEY PATTERN (from Claude Code):
  // <Static> renders completed items ONCE — they stay in terminal
  // scrollback and are NEVER re-rendered. Only the dynamic section
  // below (streaming + input) re-renders on state changes.

  const ghostText = autocomplete.getGhostText(input);
  const matches = autocomplete.getMatches(input);

  // Build static items: banner + completed messages
  const staticItems: Array<{ id: string; type: 'banner' | 'message'; data?: MessageData }> = [];

  // Banner as first static item
  if (session.messages.length === 0) {
    staticItems.push({ id: 'banner', type: 'banner' });
  }

  // All completed messages
  for (const msg of session.messages) {
    staticItems.push({ id: msg.id, type: 'message', data: msg });
  }

  return (
    <>
      {/* STATIC: completed messages — rendered once, never re-rendered */}
      <Static items={staticItems}>
        {(item) => {
          if (item.type === 'banner') {
            return (
              <Box key="banner">
                <Banner welcome={welcomeMsg} stats={stats} model={config.llm.model || 'default'} dataDir={config.dataDir} lastSessionDigest={sessionMemory.digest} growthDelta={sessionMemory.growthDelta} demoMode={demoSeeded && !llm} />
              </Box>
            );
          }
          return <Message key={item.id} message={item.data!} />;
        }}
      </Static>

      {/* DYNAMIC: only this section re-renders during streaming */}

      {/* Streaming text — throttled updates */}
      {streamingText && (
        <Box paddingLeft={2}>
          <Text>{renderMarkdown(streamingText)}</Text>
        </Box>
      )}

      {/* Spinner */}
      {loading && !streamingText && (
        <Box>
          <BrowzySpinner label={loadingLabel} elapsed={elapsed} />
        </Box>
      )}

      {/* Autocomplete */}
      <SuggestionList items={matches} selectedIndex={autocomplete.selectedIndex} visible={autocomplete.visible} />

      {/* Separator */}
      <Box>
        <Text color={theme.separator}>{'─'.repeat(cols)}</Text>
      </Box>

      {/* Input */}
      <Box>
        <Text color={theme.brand}>{'› '}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder={loading ? '' : 'Ask a question or type / for commands...'} />
        {ghostText && <Text color={theme.textMuted}>{ghostText}</Text>}
      </Box>

      {/* Stash */}
      {stashedInput && <Box><Text color={theme.textMuted}> 1 stashed draft (Ctrl+S to restore)</Text></Box>}

      {/* Status bar */}
      <StatusBar model={currentModel} sources={stats.sources} articles={stats.articles}
        hint={loading ? undefined : 'Tab complete · ↑↓ history · Ctrl+E editor · Ctrl+S stash'}
        temporaryStatus={tempStatus} costStatus={costStatus} />
    </>
  );
};

function parseMultipleSources(args: string): string[] {
  // Extract URLs directly — handles numbered lists like "1. https://..." gracefully
  const urls = args.match(/https?:\/\/[^\s,]+/gi) || [];
  // Extract file paths (start with / or ~/ or ./ or ../ and have an extension)
  const paths = args.match(/(?:\/|~\/|\.\/|\.\.\/)[^\s,]+\.\w{2,5}/g) || [];
  // Also match bare filenames with extensions (paper.pdf, notes.md)
  const bareFiles = args.match(/(?:^|\s)([\w.-]+\.\w{2,5})(?:\s|$)/g)?.map(s => s.trim()) || [];
  return [...new Set([...urls, ...paths, ...bareFiles])];
}
