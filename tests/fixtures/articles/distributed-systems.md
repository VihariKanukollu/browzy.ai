---
title: Distributed Systems
tags: [distributed-systems, cap-theorem, consensus, replication]
sources: [https://dataintensive.net/]
summary: Fundamentals of distributed systems including CAP theorem, consensus algorithms, and replication strategies.
created: 2025-02-20
updated: 2025-06-30
backlinks: [database-indexing]
---

# Distributed Systems

A distributed system is a collection of independent computers that appears to its users as a single coherent system. These systems must handle partial failures, network partitions, and concurrency while maintaining correctness and performance.

## CAP Theorem

The CAP theorem states that a distributed data store can provide at most two of three guarantees simultaneously:

- **Consistency**: Every read receives the most recent write or an error.
- **Availability**: Every request receives a response (not necessarily the most recent data).
- **Partition tolerance**: The system continues to operate despite network partitions.

In practice, network partitions are inevitable, so the real choice is between consistency (CP) and availability (AP) during a partition. Systems like ZooKeeper are CP, while Cassandra is AP.

## Consensus Algorithms

Consensus algorithms allow distributed nodes to agree on a single value despite failures. Key algorithms include:

### Paxos

Paxos ensures that a single value is chosen among proposed values. It uses proposers, acceptors, and learners. Despite its importance, Paxos is notoriously difficult to understand and implement correctly.

### Raft

Raft was designed to be more understandable than Paxos. It elects a leader who manages log replication. Raft divides consensus into leader election, log replication, and safety. When the leader fails, a new election occurs with randomized timeouts to prevent split votes.

## Replication

Replication copies data across multiple nodes for fault tolerance and read scalability.

### Single-Leader Replication

One node (the leader) accepts all writes and replicates changes to followers. Followers serve read queries. This model is simple but the leader is a single point of failure and can become a bottleneck.

### Multi-Leader Replication

Multiple nodes accept writes. Conflict resolution becomes necessary when two leaders modify the same data. Strategies include last-writer-wins, application-level resolution, and CRDTs (Conflict-Free Replicated Data Types).

### Leaderless Replication

Every node can accept reads and writes. Quorum-based systems require a majority of nodes to acknowledge a write (w) and a read must query enough nodes (r) such that w + r > n (total nodes). Dynamo-style systems use this approach.

## Consistency Models

- **Strong consistency**: After a write completes, all subsequent reads reflect it.
- **Eventual consistency**: Given no new updates, all replicas eventually converge.
- **Causal consistency**: Operations that are causally related are seen in the same order by all nodes.
- **Linearizability**: Operations appear to happen atomically at some point between their start and end.

## Failure Detection

Distributed systems use heartbeats and gossip protocols to detect node failures. Phi-accrual failure detectors provide a suspicion level rather than a binary alive/dead decision, accounting for variable network latency.
