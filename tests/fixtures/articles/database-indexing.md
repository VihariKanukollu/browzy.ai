---
title: Database Indexing
tags: [databases, indexing, performance, b-tree, query-optimization]
sources: [https://use-the-index-luke.com/]
summary: Database index structures including B-trees and hash indexes, and how they optimize query performance.
created: 2025-03-05
updated: 2025-07-14
backlinks: [distributed-systems]
---

# Database Indexing

Database indexes are data structures that improve the speed of data retrieval operations. They work similarly to a book's index — instead of scanning every page, you look up the topic in the index to find the exact page.

## B-Tree Indexes

B-trees (balanced trees) are the most common index type in relational databases. They maintain sorted data and allow searches, insertions, and deletions in O(log n) time.

A B-tree node contains multiple keys and child pointers. The branching factor (number of children per node) is typically high (hundreds), keeping the tree shallow even for millions of rows. Most B-tree indexes fit in 3-4 levels, meaning any lookup requires only 3-4 disk reads.

### B+ Trees

Most database implementations use B+ trees, a variant where all data is stored in leaf nodes and leaf nodes are linked together. This makes range queries efficient because the database can scan consecutive leaf nodes without revisiting internal nodes.

## Hash Indexes

Hash indexes use a hash function to map keys to storage locations. They provide O(1) average-case lookup time but do not support range queries or ordering. Hash indexes are useful for equality comparisons only.

## Composite Indexes

A composite index covers multiple columns. The column order matters — an index on (last_name, first_name) can efficiently answer queries on last_name alone but not first_name alone. This is called the leftmost prefix rule.

## Query Optimization

The query optimizer decides whether to use an index or perform a full table scan. Factors include:

- **Selectivity**: How many rows match the condition. High selectivity (few rows) favors index usage.
- **Index coverage**: If all required columns are in the index, the database can answer the query from the index alone (covering index) without accessing the table.
- **Join ordering**: The optimizer chooses which table to scan first and which indexes to use for joins.

### EXPLAIN Plans

Use `EXPLAIN` or `EXPLAIN ANALYZE` to see how the database executes a query. Look for sequential scans on large tables, which may indicate missing indexes.

## Index Overhead

Indexes are not free. They consume disk space and slow down INSERT, UPDATE, and DELETE operations because the index must be maintained. Over-indexing can be as harmful as under-indexing.

## Full-Text Indexes

Full-text indexes support natural language search. They tokenize text content and build an inverted index mapping words to documents. FTS5 in SQLite and GIN indexes in PostgreSQL are examples. These indexes support features like stemming, ranking, and phrase matching.

## Partial and Expression Indexes

Partial indexes cover only a subset of rows matching a condition. Expression indexes index computed values. Both reduce index size and maintenance cost while targeting specific query patterns.
