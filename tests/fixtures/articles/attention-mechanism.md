---
title: Attention Mechanism in Transformers
tags: [machine-learning, transformers, attention, deep-learning]
sources: [https://arxiv.org/abs/1706.03762]
summary: How self-attention and multi-head attention enable transformers to model long-range dependencies in sequences.
created: 2025-09-15
updated: 2025-11-20
backlinks: [neural-networks, backpropagation]
---

# Attention Mechanism in Transformers

The attention mechanism is the core innovation behind the transformer architecture introduced in "Attention Is All You Need" (Vaswani et al., 2017). It allows models to weigh the importance of different parts of the input when producing each part of the output.

## Self-Attention

Self-attention, also called intra-attention, computes a representation of a sequence by relating different positions within that same sequence. Each token in the input attends to every other token, producing a weighted combination.

Given an input sequence, self-attention computes three vectors for each token: Query (Q), Key (K), and Value (V). The attention score between two tokens is the dot product of the query of one with the key of another, scaled by the square root of the key dimension.

The softmax function normalizes these scores into attention weights, which are then used to compute a weighted sum of the value vectors. This mechanism enables the model to capture dependencies regardless of their distance in the sequence.

## Multi-Head Attention

Multi-head attention runs several attention functions in parallel, each with different learned linear projections. This allows the model to jointly attend to information from different representation subspaces at different positions.

Each head computes its own set of Q, K, V projections and produces an output. The outputs from all heads are concatenated and linearly transformed. Typically, transformers use 8 or 16 heads. Different heads learn to focus on different types of relationships — some may capture syntactic patterns while others capture semantic relationships.

## Scaled Dot-Product Attention

The scaling factor of 1/sqrt(d_k) is critical. Without it, the dot products grow large in magnitude for high-dimensional keys, pushing the softmax into regions where it has extremely small gradients. Scaling ensures stable training.

## Cross-Attention

In encoder-decoder architectures, cross-attention allows the decoder to attend to the encoder's output. The queries come from the decoder, while the keys and values come from the encoder. This is how translation models align source and target language tokens.

## Applications

Attention mechanisms power modern large language models like GPT, Claude, and LLaMA. They are also used in computer vision (Vision Transformers), speech recognition, and protein structure prediction. The ability to process sequences in parallel, unlike recurrent networks, makes transformers highly efficient on modern GPU hardware.
