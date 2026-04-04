import type { LLMConfig, LLMMessage, LLMResponse } from '../types.js';

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
  stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface StreamChunk {
  delta: string;
  snapshot: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sanitizeError(err: any, provider: string): Error {
  const message = typeof err?.message === 'string' ? err.message : String(err);
  // Strip anything that looks like an API key from error messages
  const cleaned = message.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***');
  const error = new Error(`${provider}: ${cleaned}`);
  if (typeof err?.status === 'number') {
    (error as any).status = err.status;
  }
  return error;
}

function getRetryDelay(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  }
  // Exponential backoff with jitter: 1s, 2s, 4s (capped)
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), 16_000);
  return base + Math.random() * 0.25 * base;
}

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

class ClaudeProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    if (!config.apiKey) {
      throw new Error(
        'Claude API key required. Set ANTHROPIC_API_KEY or configure in browzy.config.json'
      );
    }
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const systemMsg = options?.system ?? messages.find(m => m.role === 'system')?.content;
    const nonSystemMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model: this.config.model || 'claude-sonnet-4-20250514',
          max_tokens: options?.maxTokens ?? 4096,
          ...(systemMsg ? { system: systemMsg } : {}),
          messages: nonSystemMessages,
        });

        const textBlock = response.content.find(b => b.type === 'text');
        return {
          content: textBlock?.text ?? '',
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        };
      } catch (err: any) {
        if (err.status === 429 && attempt < MAX_RETRIES) {
          const delay = getRetryDelay(attempt, err.headers?.get?.('retry-after'));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw sanitizeError(err, 'Claude');
      }
    }
    throw new Error('Unreachable');
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const systemMsg = options?.system ?? messages.find(m => m.role === 'system')?.content;
    const nonSystemMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = client.messages.stream({
      model: this.config.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens ?? 4096,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: nonSystemMessages,
    });

    let accumulated = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        accumulated += event.delta.text;
        yield { delta: event.delta.text, snapshot: accumulated };
      }
    }
  }
}

class OpenAIProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    if (!config.apiKey) {
      throw new Error(
        'OpenAI API key required. Set OPENAI_API_KEY or configure in browzy.config.json'
      );
    }
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.apiKey });

    const allMessages = options?.system
      ? [{ role: 'system' as const, content: options.system }, ...messages.filter(m => m.role !== 'system')]
      : messages;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: this.config.model || 'gpt-4o',
          max_tokens: options?.maxTokens ?? 4096,
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
        });

        return {
          content: response.choices[0]?.message?.content ?? '',
          usage: response.usage
            ? {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens ?? 0,
              }
            : undefined,
        };
      } catch (err: any) {
        if (err.status === 429 && attempt < MAX_RETRIES) {
          const delay = getRetryDelay(attempt, err.headers?.get?.('retry-after'));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw sanitizeError(err, 'OpenAI');
      }
    }
    throw new Error('Unreachable');
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.apiKey });

    const allMessages = options?.system
      ? [{ role: 'system' as const, content: options.system }, ...messages.filter(m => m.role !== 'system')]
      : messages;

    const response = await client.chat.completions.create({
      model: this.config.model || 'gpt-4o',
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      messages: allMessages.map(m => ({ role: m.role, content: m.content })),
    });

    let accumulated = '';
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        accumulated += delta;
        yield { delta, snapshot: accumulated };
      }
    }
  }
}

/**
 * OpenRouter provider — uses OpenAI-compatible API with openrouter.ai base URL.
 * Gives access to Claude, GPT-4o, Gemini, Llama, Mistral, and 200+ models.
 * Set OPENROUTER_API_KEY or configure apiKey in browzy.config.json.
 */
class OpenRouterProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    if (!config.apiKey) {
      throw new Error(
        'OpenRouter API key required. Set OPENROUTER_API_KEY or configure in browzy.config.json'
      );
    }
  }

  private async getClient() {
    const { default: OpenAI } = await import('openai');
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://browzy.ai',
        'X-Title': 'browzy.ai',
      },
    });
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const client = await this.getClient();

    const allMessages = options?.system
      ? [{ role: 'system' as const, content: options.system }, ...messages.filter(m => m.role !== 'system')]
      : messages;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: this.config.model || 'anthropic/claude-sonnet-4',
          max_tokens: options?.maxTokens ?? 4096,
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
        });

        return {
          content: response.choices[0]?.message?.content ?? '',
          usage: response.usage
            ? {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens ?? 0,
              }
            : undefined,
        };
      } catch (err: any) {
        if (err.status === 429 && attempt < MAX_RETRIES) {
          const delay = getRetryDelay(attempt, err.headers?.get?.('retry-after'));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw sanitizeError(err, 'OpenRouter');
      }
    }
    throw new Error('Unreachable');
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient();

    const allMessages = options?.system
      ? [{ role: 'system' as const, content: options.system }, ...messages.filter(m => m.role !== 'system')]
      : messages;

    const response = await client.chat.completions.create({
      model: this.config.model || 'anthropic/claude-sonnet-4',
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      messages: allMessages.map(m => ({ role: m.role, content: m.content })),
    });

    let accumulated = '';
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        accumulated += delta;
        yield { delta, snapshot: accumulated };
      }
    }
  }
}
