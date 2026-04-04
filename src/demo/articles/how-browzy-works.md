---
title: "How browzy works"
tags: [browzy, technical, architecture]
sources: ["demo"]
backlinks: ["what-is-browzy", "getting-started", "knowledge-management-tips"]
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
summary: "Technical overview of browzy's architecture: ingest pipeline, LLM compilation, FTS5 search with BM25 ranking, and token budget management."
---

# How browzy Works

browzy has four main subsystems that work together to turn raw information into queryable knowledge.

## 1. Ingest Pipeline

When you add a source, browzy detects its type and extracts content:

- **Web pages** — fetched and converted to clean markdown, stripping nav, ads, and boilerplate
- **PDFs** — text extracted with layout awareness, tables preserved
- **Images** — analyzed via multimodal LLM to extract text and describe visual content
- **Text/Markdown** — ingested directly with minimal processing

Each source gets a unique ID, metadata (title, tags, summary), and is stored as a raw markdown file in your data directory.

## 2. LLM Compilation

This is where the magic happens. The compiler reads your raw sources and produces wiki articles:

- Related sources are grouped and synthesized into coherent articles
- Articles get `[[slug]]` cross-references to other articles, creating an interconnected knowledge graph
- YAML frontmatter tracks metadata: title, tags, sources, backlinks, timestamps
- A wiki index maps concepts to articles for fast lookup

The compiler is incremental — it only reprocesses sources that have changed.

## 3. Search (FTS5 + BM25)

browzy uses SQLite's FTS5 full-text search with BM25 ranking for fast, relevant results. Search weights are tuned so titles and tags rank higher than body content. This powers both the `/search` command and the context retrieval for Q&A — and it works entirely offline, no API key needed.

## 4. Query Engine

When you ask a question, browzy:

1. Searches the wiki for relevant articles using FTS5
2. Builds a context window with a token budget to fit the LLM's limits
3. Sends your question + context to the LLM
4. Returns an answer with confidence scoring and source attribution

The system tracks knowledge gaps — topics where your wiki is thin — and suggests sources to fill them. See [[what-is-browzy]] for the big picture, or [[knowledge-management-tips]] for how to build an effective knowledge base.
