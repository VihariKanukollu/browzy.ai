<p align="center">
  <strong style="font-size: 2em; color: #6C3BAA;">browzy.ai</strong>
</p>

<p align="center">
  <em>Your knowledge, compiled.</em>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

**browzy** is an LLM-powered personal knowledge base that lives in your terminal. Feed it articles, PDFs, images, and web links. An AI compiles everything into an interconnected knowledge base, then you ask it questions and it answers from *your* collected knowledge.

```
$ browzy

  ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗██╗   ██╗
  ██╔══██╗██╔══██╗██╔═══██╗██║    ██║╚══███╔╝╚██╗ ██╔╝
  ██████╔╝██████╔╝██║   ██║██║ █╗ ██║  ███╔╝  ╚████╔╝
  ██╔══██╗██╔══██╗██║   ██║██║███╗██║ ███╔╝    ╚██╔╝
  ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████╗   ██║
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝   ╚═╝

  Back at it. What are we chasing today, Vihari?

  sources 12  ·  articles 34  ·  concepts 87  ·  3-day streak

────────────────────────────────────────────────────────
› explain the connection between attention mechanisms and Helly's theorem
```

## Quickstart

```bash
# Install
npm install -g browzy

# Launch — first run guides you through setup
browzy
```

**No API key needed to start.** browzy ships with demo articles so you can explore immediately. When you're ready to add your own knowledge, paste your Claude API key and go.

**Add your first source:**

```
› /add https://arxiv.org/html/2604.01548v1
```

Or just paste a URL — browzy detects it and ingests automatically:

```
› https://en.wikipedia.org/wiki/Transformer_(deep_learning_model)
✓ Transformer (deep learning model)
Weaving new knowledge in... 4.2s
Your browzy just learned about Transformer (deep learning model). 2 new articles created.
```

**Ask questions:**

```
› What are the key components of the transformer architecture?
› tell me more
› how does this connect to my other articles?
```

## How it works

```
1. ADD                    2. COMPILE                3. ASK
┌──────────────┐         ┌──────────────┐          ┌──────────────┐
│  URLs        │         │  LLM reads   │          │  "Why did    │
│  PDFs        │────────▶│  raw sources, │────────▶│  transformers│
│  Images      │         │  writes       │          │  replace     │
│  Text files  │         │  articles     │          │  RNNs?"      │
└──────────────┘         └──────────────┘          └──────────────┘
       │                        │                         │
       ▼                        ▼                         ▼
   raw/*.md                articles/*.md             Streamed answer
   Web cache               FTS5 index               with citations
   Dedup check             Backlinks                 + confidence
```

**The loop that compounds:** every source you add makes every future answer better. Every question you ask can surface gaps — browzy suggests sources to fill them.

## Commands

| Command | What it does |
|---------|-------------|
| *just type* | Ask your browzy anything — this is the main action |
| `/add <sources...>` | Add URLs, PDFs, images, text files (or just paste a URL) |
| `/search <term>` | Full-text search across all articles |
| `/model` | Browse and switch models (Claude, OpenAI, OpenRouter) |
| `/health` | Stats + health checks (contradictions, gaps, orphans) |
| `/rebuild` | Force recompile all sources |
| `/format <md\|marp\|json>` | Change output format |
| `/copy` | Copy last answer to clipboard |
| `/export [file]` | Save session as markdown |
| `/clear` | Clear conversation |
| `/help` | All commands |
| `/quit` | Exit (session saved automatically) |

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `Tab` | Autocomplete commands |
| `↑` `↓` | Browse command history |
| `→` | Accept ghost text suggestion |
| `Ctrl+E` | Open input in `$EDITOR` |
| `Ctrl+S` | Stash/restore input draft |
| `Ctrl+C` | Clear input or exit |

## Features

### Smart ingestion
- **Auto-detect intent** — paste a URL, browzy ingests it. Paste a file path, same thing. No `/add` needed.
- **Topic dive** — say "I want to learn about CRISPR" and browzy searches the web, finds sources, ingests them, and compiles your browzy automatically.
- **Duplicate detection** — won't re-ingest the same URL or file content twice. Updates existing sources on re-add.
- **HTML cleanup** — strips navbars, footers, cookie banners, ads before saving.
- **Web cache** — 15-minute LRU cache so re-fetching is instant.
- **Parallel compilation** — compiles 3 sources concurrently. Small sources get template articles without LLM calls.
- **Image vision** — sends actual images to the LLM for multimodal description (diagrams, charts, formulas).

### Smart retrieval
- **Relevance ranking** — articles scored by keyword density, title match, tag match, recency, and backlink authority. Not just keyword matching.
- **Section-level chunking** — only pulls relevant sections of articles into context, not the whole thing.
- **Token budget management** — knows each model's context window, stays within limits, auto-compacts long conversations.
- **Follow-up awareness** — "tell me more" pulls different articles each time.
- **Confidence scoring** — every answer rated high/medium/low based on coverage quality.
- **Gap detection** — tells you what topics your browzy doesn't cover and suggests sources to add.
- **Gap hunter** — after an answer with gaps, searches DuckDuckGo and pre-fills `/add <url>` for you.
- **Query cache** — identical questions return cached answers instantly (invalidated on new ingest).

### Smart output
- **Real streaming** — tokens appear as the LLM generates them via Anthropic/OpenAI streaming APIs.
- **Terminal markdown** — headers, bold, italic, code blocks, tables, blockquotes, bullet/numbered lists.
- **LaTeX to Unicode** — `$\sum_{i=1}^n x_i^2$` renders as `∑ᵢ₌₁ⁿ xᵢ²` in the terminal.
- **Clickable links** — URLs shown explicitly for cmd+click.
- **Marp slides** — `/format marp` outputs presentation slide decks.
- **JSON output** — `/format json` returns structured data with confidence and gaps.

### Personality & engagement
- **Research streaks** — tracks daily usage, celebrates 3/7/30-day streaks.
- **Milestones** — "50 articles. You know more about this topic than most people alive."
- **Playful loading** — "Digging through your notes...", "Following the thread...", "Going down the rabbit hole..."
- **Session memory** — remembers what happened last session, shows digest on return.
- **Insight crystallizer** — when an answer connects 2+ articles in a novel way, quietly drafts an insight article.
- **Exit reflection** — shows session summary: questions asked, browzy growth, unresolved gaps.

### Multi-provider support
- **Claude** (default) — Anthropic API with real streaming and model picker.
- **OpenAI** — GPT-4o, o1, o3, o4 via OpenAI API.
- **OpenRouter** — 200+ models (Gemini, Llama, Mistral, DeepSeek, etc.) via openrouter.ai.
- **Live model switching** — `/model` fetches available models from your account, switch by number.
- **Paste-to-configure** — paste any API key in the prompt, browzy detects the provider and saves it.

### Security
- **Local-only** — all data at `~/.browzy/`. Nothing touches any server except the LLM API.
- **API keys** — stored in `~/.browzy/keys.json` (chmod 600). Never sent to browzy servers (there are none).
- **Secret redaction** — API keys stripped from error messages and exported markdown.
- **SSRF protection** — blocks private/internal URLs in web fetch and image downloads.
- **Path traversal protection** — sandboxed file operations.

## Source types

| Type | Input | What happens |
|------|-------|--------------|
| **Web** | URL | Fetches HTML, strips non-content, converts to markdown, downloads images |
| **PDF** | `.pdf` file | Extracts text and metadata |
| **Image** | `.png`, `.jpg`, etc. | Sends to LLM for multimodal description, indexes for search |
| **Text** | `.txt` file | Ingests with frontmatter |
| **Markdown** | `.md` file | Ingests as-is with frontmatter |

Multiple sources at once: `/add url1 url2 /path/to/file.pdf`

## Architecture

```
browzy/
├── src/
│   ├── core/                        # Engine (importable as a library)
│   │   ├── prompts.ts               # 11 system prompts (400+ lines)
│   │   ├── config.ts                # Config loading + env overrides
│   │   ├── types.ts                 # Shared types (multimodal support)
│   │   ├── ingest/                  # Source processors (web, PDF, image, text)
│   │   ├── compile/                 # Parallel wiki compiler + concept extraction
│   │   ├── query/
│   │   │   ├── engine.ts            # Query + prepare (context building without LLM)
│   │   │   ├── crystallizer.ts      # Cross-article insight detection
│   │   │   ├── digest.ts            # Session digest generation
│   │   │   └── historyManager.ts    # Conversation history management
│   │   ├── retrieval/
│   │   │   ├── contextBuilder.ts    # Relevance-ranked context assembly
│   │   │   ├── relevanceRanker.ts   # TF-IDF + multi-signal scoring
│   │   │   ├── tokenCounter.ts      # Segmented token estimation
│   │   │   ├── compactor.ts         # 9-section conversation summarization
│   │   │   ├── deduplicator.ts      # URL normalization + content hashing
│   │   │   ├── queryCache.ts        # LRU query result cache
│   │   │   └── webCache.ts          # 15-min web fetch cache
│   │   ├── discovery/
│   │   │   ├── webSearch.ts         # DuckDuckGo search (no API key)
│   │   │   ├── gapResolver.ts       # Auto-suggest sources for gaps
│   │   │   ├── clipboard.ts         # Clipboard watcher (opt-in)
│   │   │   └── freshness.ts         # Stale source detection
│   │   ├── analytics/
│   │   │   └── costTracker.ts       # Per-call LLM cost estimation
│   │   ├── lint/                    # Health checks (links, orphans, contradictions)
│   │   ├── wiki/                    # Wiki CRUD operations
│   │   ├── storage/
│   │   │   ├── filesystem.ts        # .md file I/O (path traversal protected)
│   │   │   ├── sqlite.ts           # FTS5 with BM25 + Porter stemming
│   │   │   └── migrations.ts       # Versioned schema migrations
│   │   └── llm/
│   │       ├── provider.ts          # Claude + OpenAI + OpenRouter (streaming)
│   │       └── errors.ts            # Sanitized error handling
│   ├── cli/                         # Terminal interface
│   │   ├── entry.tsx               # Entry point (Ink app or Commander CLI)
│   │   ├── app.tsx                 # Main app (intent detection, topic dive, etc.)
│   │   ├── theme.ts               # Purple brand palette (dark/light)
│   │   ├── personality.ts         # Streaks, milestones, playful copy
│   │   ├── keystore.ts            # Secure API key storage
│   │   ├── onboarding.ts          # First-run setup (name, key, model picker)
│   │   ├── components/            # Ink React components
│   │   │   ├── Banner.tsx         # Welcome screen + session digest
│   │   │   ├── Markdown.tsx       # Terminal renderer (LaTeX, tables, code)
│   │   │   ├── Message.tsx        # User/AI/system messages
│   │   │   ├── StatusBar.tsx      # Model, stats, cost, hints
│   │   │   ├── Spinner.tsx        # Animated loading
│   │   │   └── Suggestions.tsx    # Autocomplete dropdown
│   │   └── hooks/
│   │       ├── useHistory.ts      # Persistent command history
│   │       ├── useAutocomplete.ts # Slash command autocomplete
│   │       └── useSession.ts      # Session persistence + meta
│   └── demo/                       # Starter articles for first run
└── data/                           # Lives at ~/.browzy/ (not in repo)
    ├── raw/                        # Ingested sources
    ├── wiki/                       # Compiled articles
    ├── drafts/                     # Crystallized insights
    ├── output/                     # Exports
    ├── sessions/                   # Conversation history
    ├── keys.json                   # API keys (chmod 600)
    ├── profile.json                # User profile
    ├── streak.json                 # Research streaks
    ├── history.json                # Command history
    └── .browzy/browzy.db           # SQLite FTS5 index
```

## Configuration

browzy looks for config in this order:
1. `./browzy.config.json` (current directory)
2. `~/.browzy/config.json`
3. Environment variables / `~/.browzy/.env`
4. Defaults

```json
{
  "dataDir": "~/.browzy/default",
  "llm": {
    "provider": "claude",
    "model": "claude-sonnet-4-20250514"
  },
  "compile": {
    "batchSize": 20,
    "extractConcepts": true
  }
}
```

### API keys

Paste any key directly into the browzy prompt — it auto-detects the provider and saves securely:

```
› sk-ant-api03-...
Claude API key saved.
Stored locally at ~/.browzy/keys.json on your machine only.
```

Or set environment variables:

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | OpenAI |
| `OPENROUTER_API_KEY` | OpenRouter (200+ models) |

### Other settings

| Variable | Description |
|----------|-------------|
| `BROWZY_DATA_DIR` | Override data directory |
| `BROWZY_THEME` | Force `dark` or `light` theme |
| `EDITOR` | Editor for Ctrl+E (defaults to `vi`) |

## Obsidian compatibility

browzy's articles are plain `.md` files with YAML frontmatter — fully compatible with Obsidian:

1. Open `~/.browzy/default/wiki/` as an Obsidian vault
2. `[[wiki-links]]` work as Obsidian internal links
3. The graph view shows your knowledge network
4. Install Marp plugin for `/format marp` slide decks

## Tech stack

- **TypeScript** (full stack)
- **Ink** (React for terminals) + **React 19**
- **Anthropic SDK** + **OpenAI SDK** (Claude, GPT, OpenRouter)
- **SQLite** (better-sqlite3) with **FTS5** (Porter stemming, BM25 ranking)
- **gray-matter** (YAML frontmatter) + **Turndown** (HTML→markdown)
- **DuckDuckGo** (web search, no API key needed)

## Development

```bash
git clone <your-repo>
cd browzy.ai
npm install
npm run build
sudo npm link    # Makes 'browzy' available globally
npm run dev      # Watch mode
npm test         # Run tests
```

## License

[MIT](LICENSE) - Vihari Kanukollu
