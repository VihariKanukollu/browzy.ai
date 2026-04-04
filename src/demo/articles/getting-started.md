---
title: "Getting started with browzy"
tags: [browzy, getting-started, tutorial]
sources: ["demo"]
backlinks: ["what-is-browzy", "browzy-vs-alternatives"]
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
summary: "Quick start guide for browzy: add sources, ask questions, and grow your personal knowledge base."
---

# Getting Started with browzy

You're already running browzy — these starter articles are your first knowledge base. Here's how to make it yours.

## Step 1: Add Your First Source

Paste a URL to add knowledge from the web:

```
/add https://example.com/interesting-article
```

browzy will fetch the page, extract its content, and compile it into your wiki. You can also add PDFs, images, and text files.

## Step 2: Ask Questions

Just type a question — no command needed:

```
What are the key points from that article?
```

browzy searches your wiki, gathers relevant context, and gives you an answer grounded in your sources. The more sources you add, the richer the answers become.

## Step 3: Explore Your Wiki

Use `/search` to browse what's in your knowledge base:

```
/search machine learning
```

Check your wiki's health with `/health` to see stats and suggestions for improvement.

## Tips for Best Results

- **Start with what you're curious about** — add articles, papers, or notes on topics you're actively exploring
- **Ask follow-up questions** — browzy tracks conversation context and can go deeper
- **Mix source types** — combine web articles, PDFs, and your own notes for richer synthesis
- **Let gaps guide you** — when browzy says coverage is thin, that's a hint to add more sources on that topic

See [[knowledge-management-tips]] for more advanced strategies, or [[what-is-browzy]] to understand [[how-browzy-works]] better.

## Useful Commands

| Command | What it does |
|---------|-------------|
| `/add <url>` | Add a source to your wiki |
| `/search <term>` | Find articles by keyword |
| `/health` | Check wiki stats and quality |
| `/model` | Switch LLM models |
| `/help` | See all commands |
