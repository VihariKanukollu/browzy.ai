---
title: Backpropagation and Optimization
tags: [machine-learning, backpropagation, optimization, gradient-descent]
sources: [https://www.nature.com/articles/323533a0]
summary: How gradient descent and the chain rule enable neural networks to learn through backpropagation.
created: 2025-07-20
updated: 2025-09-18
backlinks: [neural-networks]
---

# Backpropagation and Optimization

Backpropagation is the algorithm used to compute gradients of the loss function with respect to each weight in a neural network. Combined with gradient descent, it allows the network to learn by iteratively adjusting weights to minimize the loss.

## The Chain Rule

Backpropagation relies on the chain rule of calculus. For a composite function f(g(x)), the derivative is f'(g(x)) * g'(x). In a neural network, the loss is a composition of many functions (one per layer), so the chain rule is applied repeatedly to propagate gradients backward through the network.

## Gradient Descent

Gradient descent is an optimization algorithm that updates parameters in the direction of steepest descent of the loss function. The update rule is: w = w - learning_rate * gradient. The learning rate controls the step size.

### Variants of Gradient Descent

- **Batch gradient descent**: Computes the gradient using the entire training dataset. Stable but slow for large datasets.
- **Stochastic gradient descent (SGD)**: Uses a single sample per update. Noisy but fast and can escape local minima.
- **Mini-batch SGD**: Compromises between batch and stochastic by using small batches (typically 32-256 samples).

## Advanced Optimizers

- **Adam (Adaptive Moment Estimation)**: Combines momentum and adaptive learning rates. Maintains running averages of both the gradient and its square. The most popular optimizer for deep learning.
- **AdaGrad**: Adapts the learning rate for each parameter based on historical gradient magnitudes.
- **RMSProp**: Addresses AdaGrad's diminishing learning rates by using exponential decay.
- **SGD with Momentum**: Adds a velocity term that accumulates past gradients, smoothing out oscillations.

## Learning Rate Scheduling

The learning rate often needs to change during training. Common schedules include step decay (reduce by factor every N epochs), cosine annealing, warm-up followed by decay, and cyclical learning rates. Learning rate warm-up is particularly important for transformer training.

## Challenges

- **Vanishing gradients**: In deep networks, gradients can shrink exponentially as they propagate backward, making early layers learn very slowly.
- **Exploding gradients**: Gradients can also grow exponentially, causing numerical instability. Gradient clipping helps mitigate this.
- **Saddle points**: In high-dimensional optimization, saddle points are more common than local minima and can slow down training.
- **Overfitting**: The network memorizes training data instead of generalizing. Regularization techniques like dropout, weight decay, and early stopping help prevent this.
