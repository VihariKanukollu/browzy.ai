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
import { useSession } from './hooks/useSession.js';
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
import { QUERY_SYSTEM_PROMPT, CONVERSATION_CONTEXT_PROMPT } from '../core/prompts.js';
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

  // Save session on unmount
  useEffect(() => {
    return () => { session.saveSession(); };
  }, []);

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
      const fullResult = await engine.query(question, { format: 'markdown' as OutputFormat, save: false });

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
      setTempStatus(getQueryReward(fullResult.sourcesUsed.length));

      // Check for milestones
      const milestone = checkMilestones(stats);
      if (milestone) session.addMessage('system', `\n${milestone}`);
    } catch (err: any) {
      setStreamingText('');
      session.addMessage('system', `Error: ${err.message}`);
    }

    setLoading(false);
    refreshStats();
  }, [llm, config, session, refreshStats, stats]);

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
        let lastTitle = '';

        for (let i = 0; i < sources.length; i++) {
          setLoadingLabel(getIngestingMessage());
          try {
            const result = await ingest(sources[i], config.dataDir, { llm });
            lastTitle = result.title;
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
        const newStats = stats;
        const reward = getAddReward(lastTitle, created, updated, newStats.articles + created);
        if (reward) session.addMessage('system', reward);

        // Check milestones
        const milestone = checkMilestones({ ...newStats, articles: newStats.articles + created });
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
              const data = await resp.json() as { data: Array<{ id: string; name: string }> };
              // Show top models, grouped nicely
              const popular = ['anthropic/claude', 'openai/gpt-4', 'openai/o', 'google/gemini', 'meta-llama', 'mistralai', 'deepseek'];
              models = data.data
                .filter((m: { id: string }) => popular.some(p => m.id.startsWith(p)))
                .slice(0, 30)
                .map((m: { id: string; name: string }) => ({ id: m.id, display_name: m.name }));
            }

            else if (provider === 'openai') {
              const key = getKey('openai');
              if (!key) { session.addMessage('system', 'No OpenAI API key found. Paste your key below — it starts with sk-...\nGet one at platform.openai.com/api-keys'); setLoading(false); return; }
              const { default: OpenAI } = await import('openai');
              const client = new OpenAI({ apiKey: key });
              const list = await client.models.list();
              models = Array.from(list.data)
                .filter((m: { id: string }) => m.id.startsWith('gpt-'))
                .sort((a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id))
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
      case '/help':
        session.addMessage('system', [
          'Just type a question — your browzy will find the answer.',
          '',
          '/add <sources...>     Feed your browzy new knowledge',
          '/model [model-id]     Switch models',
          '/health               How is your browzy doing?',
          '/rebuild              Recompile from scratch',
          '/export [file]        Save this session as markdown',
          '/quit                 Exit (your browzy remembers everything)',
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
  }, [llm, config, session, refreshStats, handleQuery, exit]);

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
    const cmds = ['add', 'health', 'rebuild', 'model', 'export', 'help', 'quit', 'exit', 'q'];
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
                <Banner welcome={welcomeMsg} stats={stats} model={config.llm.model || 'default'} dataDir={config.dataDir} />
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
