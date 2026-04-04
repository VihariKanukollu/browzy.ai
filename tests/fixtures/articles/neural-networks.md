---
title: Neural Networks Fundamentals
tags: [machine-learning, neural-networks, deep-learning, activation-functions]
sources: [https://www.deeplearningbook.org/]
summary: Foundational concepts of neural networks including layers, neurons, activation functions, and forward propagation.
created: 2025-08-10
updated: 2025-10-05
backlinks: [attention-mechanism, backpropagation]
---

# Neural Networks Fundamentals

A neural network is a computational model inspired by biological neurons. It consists of layers of interconnected nodes (neurons) that process and transform input data through learned weights and biases.

## Architecture and Layers

Neural networks are organized into layers. The input layer receives raw data, hidden layers perform intermediate computations, and the output layer produces predictions. A network with multiple hidden layers is called a deep neural network.

Each neuron computes a weighted sum of its inputs, adds a bias term, and passes the result through an activation function. The weights and biases are the learnable parameters of the network, adjusted during training to minimize a loss function.

## Activation Functions

Activation functions introduce non-linearity, enabling networks to learn complex patterns. Common activation functions include:

- **ReLU (Rectified Linear Unit)**: f(x) = max(0, x). Simple and effective, but can suffer from "dying ReLU" where neurons stop activating.
- **Sigmoid**: f(x) = 1/(1 + e^(-x)). Squashes output to [0, 1], useful for binary classification. Prone to vanishing gradients.
- **Tanh**: f(x) = (e^x - e^(-x))/(e^x + e^(-x)). Output in [-1, 1], zero-centered.
- **GELU**: Gaussian Error Linear Unit, used in modern transformers. Smoother than ReLU.
- **Softmax**: Converts a vector of values into a probability distribution. Used in the output layer for multi-class classification.

## Forward Propagation

During forward propagation, data flows from the input layer through hidden layers to the output layer. At each layer, the computation is: output = activation(W * input + b), where W is the weight matrix and b is the bias vector.

## Loss Functions

The loss function quantifies how far the network's predictions are from the true values. Common choices include mean squared error (MSE) for regression and cross-entropy loss for classification tasks.

## Types of Neural Networks

- **Feedforward networks (MLPs)**: The simplest architecture where data flows in one direction.
- **Convolutional Neural Networks (CNNs)**: Specialized for spatial data like images, using convolutional filters.
- **Recurrent Neural Networks (RNNs)**: Process sequential data by maintaining hidden state across time steps.
- **Transformers**: Use self-attention instead of recurrence, enabling parallel processing of sequences.

## Universal Approximation Theorem

A neural network with a single hidden layer containing a sufficient number of neurons can approximate any continuous function on a compact subset of R^n. This theoretical result explains the expressiveness of neural networks but says nothing about how easy it is to find the right weights through training.
