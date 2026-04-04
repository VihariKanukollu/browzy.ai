import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, Static, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync as wfs, readFileSync as rfs, unlinkSync } from 'fs';
import { execSync } from 'child_process';
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
  getAddReward, getQueryReward, getExitMessage, getHealthReward,
} from './personality.js';
import { getKey, saveKey, looksLikeApiKey } from './keystore.js';
import { loadConfig, ensureDataDirs, createProvider } from '../core/index.js';
import { ingest } from '../core/ingest/index.js';
import { WikiCompiler } from '../core/compile/index.js';
import { QueryEngine } from '../core/query/index.js';
import { WikiLinter } from '../core/lint/index.js';
import { Wiki } from '../core/wiki/index.js';
import { compactConversation } from '../core/retrieval/index.js';
import { resolveGap } from '../core/discovery/index.js';
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
  const [crystallizedThisSession, setCrystallizedThisSession] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('markdown');

  // Refs
  const inputRef = useRef(input);
  inputRef.current = input;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // Hooks
  const history = useHistory();
  const autocomplete = useAutocomplete();
  const session = useSession();

  // Config + LLM
  const [config, setConfig] = useState<BrowzyConfig>(() => {
    const c = loadConfig();
    ensureDataDirs(c);
    return c;
  });
  const [llm, setLlm] = useState<LLMProvider>(() => createProvider(config.llm));

  // Set initial model name
  useEffect(() => { setCurrentModel(config.llm.model || 'default'); }, []);

  // Stats — loaded synchronously so the banner has correct values on first render
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
    if (sessionMemory.meta && !sessionMemory.digest) {
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
  }, []);

  // Welcome & streak — computed once with stats available
  const [welcomeMsg] = useState(() => {
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

  useEffect(() => { refreshStats(); }, [refreshStats]);

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
  const savedRef = useRef(false);
  const saveOnce = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    session.saveSession();
    session.saveSessionMeta(stats);
  }, [session, stats]);

  useEffect(() => {
    const handler = () => { saveOnce(); process.exit(0); };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    process.on('SIGHUP', handler);
    return () => {
      saveOnce();
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      process.removeListener('SIGHUP', handler);
    };
  }, [saveOnce]);

  // ── Streaming with throttle ─────────────────────────────────

  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSnapshotRef = useRef('');

  const handleQuery = useCallback(async (question: string) => {
    session.addMessage('user', question);
    recordQuery();
    setLoading(true);
    setLoadingLabel(getThinkingMessage());
    setStreamingText('');
    latestSnapshotRef.current = '';

    try {
      // Use real streaming from the LLM provider

      // Gather wiki context
      const wikiObj = new Wiki(config.dataDir);
      const searchResults = wikiObj.search(question, 5);
      wikiObj.close();

      // Build context
      const engine = new QueryEngine(config.dataDir, llm);
      const fullResult = await engine.query(question, { format: outputFormat, save: false });

      // Now stream via provider
      let finalText = '';
      if (llm.stream) {
        try {
          // Build conversation history for context continuity
          const recentHistory = session.messages.slice(-6).map(m => ({
            role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
            content: m.content.slice(0, 500), // Truncate for context window
          }));

          const systemPrompt = QUERY_SYSTEM_PROMPT + '\n\n' + CONVERSATION_CONTEXT_PROMPT;

          for await (const chunk of llm.stream(
            [...recentHistory, { role: 'user' as const, content: `Context from wiki:\n${fullResult.answer.slice(0, 2000)}\n\nQuestion: ${question}` }],
            { system: systemPrompt, maxTokens: 8192 }
          )) {
            latestSnapshotRef.current = chunk.snapshot;
            finalText = chunk.snapshot;

            // Throttle to ~4fps
            if (!streamThrottleRef.current) {
              streamThrottleRef.current = setTimeout(() => {
                setStreamingText(latestSnapshotRef.current);
                streamThrottleRef.current = null;
              }, 250);
            }
          }
        } catch {
          // Fallback to non-streaming result
          finalText = fullResult.answer;
        }
      } else {
        finalText = fullResult.answer;
      }

      // Clear throttle
      if (streamThrottleRef.current) {
        clearTimeout(streamThrottleRef.current);
        streamThrottleRef.current = null;
      }

      setStreamingText('');
      session.addMessage('assistant', finalText || fullResult.answer, fullResult.sourcesUsed);

      // Insight Crystallizer — fire and forget, max 1 per session
      if (!crystallizedThisSession && fullResult.sourcesUsed.length >= 2) {
        try {
          const wikiForCrystal = new Wiki(config.dataDir);
          const sourceContents = fullResult.sourcesUsed.slice(0, 5).map(slug => {
            const article = wikiForCrystal.getArticle(slug);
            return article ? { slug, content: article.content } : null;
          }).filter(Boolean) as Array<{ slug: string; content: string }>;
          wikiForCrystal.close();

          if (sourceContents.length >= 2) {
            crystallize(question, finalText || fullResult.answer, fullResult.sourcesUsed, sourceContents, config.dataDir, llm)
              .then(result => {
                if (result.saved) {
                  setCrystallizedThisSession(true);
                  setTempStatus(prev => prev ? `${prev} · insight drafted` : 'insight drafted');
                }
              })
              .catch(() => { /* silently fail */ });
          }
        } catch { /* silently fail */ }
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

      // Check for milestones
      const milestone = checkMilestones(stats);
      if (milestone) session.addMessage('system', milestone);

      // Auto-compact if conversation is getting long (>20 messages)
      if (session.messages.length > 20) {
        try {
          const compacted = await compactConversation(
            session.messages.map(m => ({ role: m.role, content: m.content })),
            llm,
            6, // Keep last 6 messages
          );
          if (compacted.summary) {
            // Replace messages with compacted version
            session.setMessages(compacted.keptMessages.map(m => ({
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
              timestamp: Date.now(),
            })));
          }
        } catch { /* compaction failed, continue with full history */ }
      }
    } catch (err: any) {
      setStreamingText('');
      session.addMessage('system', `Error: ${err.message}`);
    }

    setLoading(false);
    refreshStats();
  }, [llm, config, session, refreshStats, stats, outputFormat]);

  // ── Commands ────────────────────────────────────────────────

  const handleCommand = useCallback(async (cmdInput: string) => {
    const parts = cmdInput.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/add': {
        if (!args) { session.addMessage('system', 'Drop a URL or file path after /add. Drag files into the terminal to paste their paths.'); return; }
        const sources = parseMultipleSources(args);
        setLoading(true);
        const addedTitles: string[] = [];

        for (let i = 0; i < sources.length; i++) {
          setLoadingLabel(getIngestingMessage());
          try {
            const result = await ingest(sources[i], config.dataDir, { llm });
            addedTitles.push(result.title);
            recordSourceAdded();
            session.addMessage('system', `✓ ${result.title}`);
          } catch (err: any) {
            session.addMessage('system', `✗ ${sources[i]}: ${err.message}`);
          }
        }

        setLoadingLabel(getCompilingMessage());
        let created = 0, updated = 0;
        try {
          const compiler = new WikiCompiler(config.dataDir, llm);
          const result = await compiler.compile({ batchSize: config.compile.batchSize, extractConcepts: config.compile.extractConcepts });
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
        setLoading(true); setLoadingLabel(getHealthMessage()); refreshStats();
        try {
          const linter = new WikiLinter(config.dataDir, llm);
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
        setLoading(true); setLoadingLabel(getCompilingMessage());
        try {
          const compiler = new WikiCompiler(config.dataDir, llm);
          const r = await compiler.compile({ batchSize: config.compile.batchSize, extractConcepts: config.compile.extractConcepts });
          const total = r.articlesCreated.length + r.articlesUpdated.length;
          session.addMessage('system', total === 0
            ? 'Your browzy is up to date. Nothing to rebuild.'
            : `Rebuilt: ${r.articlesCreated.length} new, ${r.articlesUpdated.length} updated. Your browzy just got sharper.`);
        } catch (err: any) { session.addMessage('system', `Rebuild hit a snag: ${err.message}`); }
        setLoading(false); refreshStats(); break;
      }
      case '/model': {
        const switchTo = (provider: 'claude' | 'openai' | 'openrouter', modelId: string, apiKey: string, displayName?: string) => {
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
            // Determine provider from model ID
            const provider = picked.id.startsWith('claude') ? 'claude' as const
              : picked.id.includes('/') ? 'openrouter' as const
              : 'openai' as const;
            const apiKey = provider === 'claude' ? (getKey('anthropic') || config.llm.apiKey)
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

            setLastModelList(models);

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
        const safe = (args || `session-${session.sessionId}.md`).replace(/\.\./g, '').replace(/^\//, '').replace(/[^\w\-./]/g, '_');
        const path = session.exportSession(join(config.dataDir, 'output', safe));
        session.addMessage('system', `Saved to ${path}. Your research, preserved.`); break;
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
      case '/help':
        session.addMessage('system', [
          'Just type a question — your browzy will find the answer.',
          '',
          '/add <sources...>     Feed your browzy (URLs, PDFs, images, .md, .txt)',
          '/search <term>        Find articles in your browzy',
          '/format <type>        Output format: markdown, marp, json',
          '/copy                 Copy last answer to clipboard',
          '/health               How is your browzy doing?',
          '/model <provider>     Switch LLM model',
          '/export               Save session to file',
          '/rebuild              Force recompilation',
          '/clear                Clear conversation',
          '/help                 Show this help',
          '',
          'Keys: Tab complete · ↑↓ history · Ctrl+E editor · Ctrl+S stash',
        ].join('\n'));
        break;
      case '/quit': case '/exit': case '/q':
        session.saveSession();
        session.addMessage('system', getExitMessage(loadStreak()));
        setTimeout(() => exit(), 300); // Brief pause so they see the exit message
        break;
      default: session.addMessage('system', `Hmm, I don't know "${cmd}". Type /help to see what I can do.`);
    }
  }, [llm, config, session, refreshStats, handleQuery, exit, outputFormat]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setInput('');
    autocomplete.setVisible(false);

    // Detect pasted API keys — save them, don't send to LLM
    const keyDetect = looksLikeApiKey(trimmed);
    if (keyDetect) {
      saveKey(keyDetect.provider, keyDetect.key);
      const names = { anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter' };
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

    let normalized = trimmed.replace(/^browzy\s+/i, '');
    const cmds = ['add', 'search', 'format', 'copy', 'health', 'rebuild', 'model', 'export', 'help', 'quit', 'exit', 'q', 'clear'];
    const first = normalized.split(/\s+/)[0].toLowerCase().replace(/^\//, '');
    if (cmds.includes(first)) normalized = '/' + (normalized.startsWith('/') ? normalized.slice(1) : normalized);

    if (normalized.startsWith('/')) await handleCommand(normalized);
    else await handleQuery(normalized);
  }, [autocomplete, history, handleCommand, handleQuery]);

  // ── Keyboard ────────────────────────────────────────────────

  useInput((ch, key) => {
    if (loadingRef.current) return;

    if (key.ctrl && ch === 'c') {
      if (inputRef.current) setInput('');
      else { session.saveSession(); setTimeout(() => exit(), 50); }
      return;
    }
    if (key.ctrl && ch === 'd') { session.saveSession(); setTimeout(() => exit(), 50); return; }
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
    try { execSync(`${editor} ${tmp}`, { stdio: 'inherit' }); const r = rfs(tmp, 'utf-8').trim(); if (r) setInput(r); }
    catch { /* cancelled */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
  };

  useEffect(() => { autocomplete.updateForInput(input); }, [input]);

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
                <Banner welcome={welcomeMsg} stats={stats} model={config.llm.model || 'default'} dataDir={config.dataDir} lastSessionDigest={sessionMemory.digest} growthDelta={sessionMemory.growthDelta} />
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
        temporaryStatus={tempStatus} />
    </>
  );
};

function parseMultipleSources(args: string): string[] {
  const sources: string[] = [];
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match;
  while ((match = regex.exec(args)) !== null) sources.push(match[1] || match[2] || match[3]);
  return sources;
}
