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
  <a href="#architecture">Architecture</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

**browzy** is an LLM-powered personal knowledge base engine. Feed it articles, PDFs, images, and web links. It compiles everything into an interconnected wiki, then lets you ask questions, run health checks, and generate reports against your collected knowledge.

```
$ browzy

  ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗██╗   ██╗
  ██╔══██╗██╔══██╗██╔═══██╗██║    ██║╚══███╔╝╚██╗ ██╔╝
  ██████╔╝██████╔╝██║   ██║██║ █╗ ██║  ███╔╝  ╚████╔╝
  ██╔══██╗██╔══██╗██║   ██║██║███╗██║ ███╔╝    ╚██╔╝
  ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████╗   ██║
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝   ╚═╝

  Good morning, Vihari. What are we researching today?

  sources 12    articles 34    concepts 87
  model   claude-sonnet-4-20250514

────────────────────────────────────────────────────────
› explain Helly's theorem and its applications
```

## Quickstart

```bash
# Install globally
npm install -g browzy

# First launch — guided setup (name, API key, model picker)
browzy

# Or set your API key and init manually
export ANTHROPIC_API_KEY=sk-ant-...
browzy init
```

**Add your first source:**

```bash
# From the interactive prompt
/add https://arxiv.org/html/2604.01548v1

# Or from the command line
browzy ingest https://en.wikipedia.org/wiki/Transformer_(deep_learning_model)
browzy ingest ~/Downloads/paper.pdf
browzy ingest ~/research/notes.md
browzy compile
```

**Ask questions:**

```
› What are the key components of the transformer architecture?
› How does multi-head attention differ from self-attention?
› /health
```

## How it works

```
1. ADD                    2. COMPILE                3. ASK
┌──────────────┐         ┌──────────────┐          ┌──────────────┐
│  URLs        │         │  LLM reads   │          │  "Why did    │
│  PDFs        │────────▶│  raw sources, │────────▶│  transformers│
│  Images      │         │  writes wiki  │          │  replace     │
│  Text files  │         │  articles     │          │  RNNs?"      │
└──────────────┘         └──────────────┘          └──────────────┘
       │                        │                         │
       ▼                        ▼                         ▼
   raw/*.md                wiki/*.md                 Terminal output
   _manifest.json          _index.json               or saved .md/.marp
   SQLite index            SQLite FTS                 filed back into wiki
```

**The loop that compounds:**

1. **Ingest** raw sources (web, PDF, image, text) into `raw/`
2. **Compile** sources into interconnected wiki articles with cross-references, citations, and concept extraction
3. **Ask** questions — browzy searches the wiki via FTS, gathers relevant articles, and synthesizes an answer with the LLM
4. **Save** answers back into the wiki, so your explorations always build on themselves
5. **Lint** the wiki for contradictions, broken links, gaps, and quality issues

## Commands

browzy has two interfaces: an **interactive REPL** (type `browzy`) and a **CLI** (type `browzy <command>`).

### Interactive mode

Type `browzy` to enter the interactive prompt. Just type a question to query your knowledge base, or use `/` commands:

| Command | Description |
|---------|-------------|
| `/add <sources...>` | Add URLs, PDFs, images, or text files. Ingests + auto-compiles. |
| `/ask <question>` | Explicitly query the knowledge base |
| `/health` | Stats + wiki health checks (contradictions, gaps, orphans) |
| `/rebuild` | Force recompile all sources into the wiki |
| `/format <md\|marp\|json>` | Set output format for answers |
| `/save` | Toggle auto-save for query outputs |
| `/export [filename]` | Export current session as markdown |
| `/help` | Show all commands |
| `/quit` | Exit |

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `Tab` | Autocomplete commands |
| `↑` `↓` | Browse command history |
| `→` | Accept ghost text suggestion |
| `Ctrl+E` | Open current input in `$EDITOR` |
| `Ctrl+S` | Stash/restore input draft |
| `Ctrl+C` | Clear input or exit |
| `Ctrl+D` | Exit |

### CLI mode

For scripting and pipelines:

```bash
browzy init                           # Initialize a knowledge base
browzy ingest <url-or-file>           # Ingest a source
browzy compile                        # Compile wiki from sources
browzy query "your question"          # Ask a question
browzy search "term"                  # Full-text search
browzy lint                           # Run health checks
browzy status                         # Show KB overview
```

## Source types

| Type | Input | What happens |
|------|-------|--------------|
| **Web** | URL | Fetches HTML, converts to markdown, downloads images |
| **PDF** | `.pdf` file | Extracts text and metadata |
| **Image** | `.png`, `.jpg`, `.webp`, etc. | Copies to images dir, generates LLM description for indexing |
| **Text** | `.txt` file | Ingests with frontmatter |
| **Markdown** | `.md` file | Ingests as-is with frontmatter |

Multiple sources at once:
```
/add https://arxiv.org/html/2604.01548v1 ~/paper.pdf ~/notes.md
```

Drag and drop files into the terminal to paste their paths.

## Output formats

| Format | Command | Use case |
|--------|---------|----------|
| **Markdown** | `/format markdown` | Default. Rich text with headers, lists, code blocks, LaTeX |
| **Marp** | `/format marp` | Slide decks viewable in Obsidian (Marp plugin) or exported to PDF |
| **JSON** | `/format json` | Structured data with sections, confidence scores, and gap analysis |

## Architecture

```
browzy/
├── src/
│   ├── core/                    # The engine (importable as a library)
│   │   ├── prompts.ts           # All system prompts (412 lines, 11 prompts)
│   │   ├── config.ts            # Config loading + env var overrides
│   │   ├── types.ts             # Shared TypeScript types
│   │   ├── ingest/              # Source processors (web, PDF, image, text)
│   │   ├── compile/             # Wiki compiler (incremental, concept extraction)
│   │   ├── query/               # Q&A engine (FTS search + LLM synthesis)
│   │   ├── lint/                # Health checks (links, orphans, contradictions)
│   │   ├── wiki/                # Wiki CRUD operations
│   │   ├── storage/
│   │   │   ├── filesystem.ts    # .md file I/O with path traversal protection
│   │   │   └── sqlite.ts        # FTS5 search index + metadata
│   │   └── llm/
│   │       └── provider.ts      # Pluggable LLM (Claude + OpenAI, real streaming)
│   └── cli/                     # Terminal interface
│       ├── entry.tsx            # Entry point (Ink app or Commander CLI)
│       ├── app.tsx              # Main Ink app (React for terminals)
│       ├── theme.ts             # Color system (dark/light, brand palette)
│       ├── onboarding.ts        # First-run setup (name, API key, model picker)
│       ├── components/
│       │   ├── Banner.tsx       # Welcome screen with stats
│       │   ├── Markdown.tsx     # Terminal markdown renderer (+ LaTeX → Unicode)
│       │   ├── Message.tsx      # User/AI/system message display
│       │   ├── Spinner.tsx      # Animated loading indicator
│       │   ├── StatusBar.tsx    # Persistent footer bar
│       │   └── Suggestions.tsx  # Autocomplete dropdown
│       └── hooks/
│           ├── useHistory.ts    # Persistent command history
│           ├── useAutocomplete.ts # Slash command autocomplete
│           └── useSession.ts    # Session persistence + export
└── data/                        # Lives at ~/.browzy/ (not in repo)
    ├── raw/                     # Ingested source documents
    │   ├── *.md                 # Converted sources with YAML frontmatter
    │   ├── images/              # Downloaded/copied images
    │   └── _manifest.json       # Source registry
    ├── wiki/                    # Compiled wiki
    │   ├── *.md                 # Articles with frontmatter (tags, backlinks, sources)
    │   └── _index.json          # Article index + concept map
    ├── output/                  # Generated reports, slides, exports
    ├── sessions/                # Saved conversation history
    └── .browzy/
        └── browzy.db            # SQLite FTS5 index
```

### Key design decisions

- **Data lives outside the repo** at `~/.browzy/` by default. Multiple knowledge bases are independently git-trackable.
- **Explicit storage layer** separates filesystem (`.md` files) from SQLite (indexes, search). Swappable.
- **Pluggable LLM** with real streaming. Claude is default, OpenAI supported. Both providers support `chat()` and `stream()`.
- **Core is a library.** `src/core/` is importable — the CLI is just one interface. A web UI or API server can use the same engine.
- **Ink-based TUI.** React components for the terminal. `<Static>` for completed messages (never re-renders), dynamic section for streaming + input.

### Prompt engineering

browzy's prompts are in `src/core/prompts.ts` — 412 lines across 11 specialized prompts. Each is purpose-built:

| Prompt | Purpose |
|--------|---------|
| `QUERY_SYSTEM_PROMPT` | 8-section prompt for Q&A: identity, context rules, citations, formatting, math, honesty, tone, anti-patterns |
| `COMPILER_SYSTEM_PROMPT` | Wiki compilation with quality standards and "what makes a bad article" guidance |
| `LINTER_SYSTEM_PROMPT` | 7-category health check with strict JSON output format |
| `SEARCH_EXTRACTION_PROMPT` | Domain-aware search term extraction with examples |
| `CONTRADICTION_HANDLING_PROMPT` | Protocol for when new sources disagree with existing wiki |
| `CONVERSATION_CONTEXT_PROMPT` | Multi-turn continuity rules (pronouns, follow-ups, corrections) |
| `ARTICLE_OUTPUT_FORMAT` | Exact parser format for compiled articles |
| `CONCEPT_EXTRACTION_PROMPT` | Bridging concepts, foundational gaps, missing counterparts |
| `IMAGE_DESCRIPTION_PROMPT` | Systematic image analysis for indexing |
| `MARP_OUTPUT_PROMPT` | Full Marp slide deck specification |
| `JSON_OUTPUT_PROMPT` | Structured JSON output with confidence + gaps |

## Configuration

### Config file

browzy looks for config in this order:
1. `./browzy.config.json` (current directory)
2. `~/.browzy/config.json`
3. Environment variables
4. Defaults

```json
{
  "dataDir": "/Users/you/.browzy/default",
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

### Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI provider) |
| `BROWZY_DATA_DIR` | Override data directory |
| `BROWZY_THEME` | Force `dark` or `light` theme |
| `EDITOR` | Editor for Ctrl+E (defaults to `vi`) |

### .env file

Create a `.env` file in your project directory:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Obsidian integration

browzy's wiki is a directory of `.md` files with YAML frontmatter — fully compatible with Obsidian.

1. Open `~/.browzy/default/wiki/` as an Obsidian vault
2. `[[wiki-links]]` work as Obsidian internal links
3. Install the Marp plugin to view `/format marp` slide decks
4. The graph view shows your wiki's concept network

## Tech stack

- **TypeScript** (full stack)
- **Ink** (React for terminals) + **React 19**
- **Anthropic SDK** (Claude) + **OpenAI SDK** (GPT)
- **SQLite** (better-sqlite3) with **FTS5** full-text search
- **gray-matter** for YAML frontmatter
- **Turndown** for HTML-to-markdown conversion
- **pdf-parse** for PDF text extraction
- **chalk** for terminal colors
- **Commander.js** for CLI subcommands

## Development

```bash
git clone https://github.com/VihariKanukollu/browzy.ai.git
cd browzy.ai
npm install
npm run build
sudo npm link    # Makes 'browzy' available globally

# Development mode (watch for changes)
npm run dev
```

## License

MIT
