import type { LLMConfig, LLMMessage, LLMResponse } from '../types.js';
import { classifyError } from './errors.js';

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
  stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;
  /** Enable prompt caching for the system message (Anthropic-specific) */
  cacheSystem?: boolean;
}

export interface StreamChunk {
  delta: string;
  snapshot: string;
}

/**
 * Format message content for the Anthropic API.
 * Handles both plain text and multimodal (text + image) content.
 */
function formatContentForAnthropic(content: string | Array<{ type: string; [key: string]: any }>): any {
  if (typeof content === 'string') return content;

  // Multimodal: convert our types to Anthropic's format
  return content.map(block => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'image') {
      return {
        type: 'image',
        source: block.source,
      };
    }
    return block;
  });
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
    // Handle both string values and Headers API .get() results
    const headerValue = typeof retryAfterHeader === 'string' ? retryAfterHeader : String(retryAfterHeader);
    const seconds = parseInt(headerValue, 10);
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
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Try to create an LLM provider, returning null if no API key is configured.
 * Used for zero-config first run where LLM is optional.
 */
export function tryCreateProvider(config: LLMConfig): LLMProvider | null {
  // Ollama doesn't need an API key — it's local
  if (!config.apiKey && config.provider !== 'ollama') return null;
  try {
    return createProvider(config);
  } catch {
    return null;
  }
}

/**
 * Check if Ollama is running locally.
 * Returns true if the Ollama server responds at the given base URL.
 */
export async function isOllamaRunning(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
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

    const systemContent = messages.find(m => m.role === 'system')?.content;
    const systemMsg = options?.system ?? (typeof systemContent === 'string' ? systemContent : undefined);
    const nonSystemMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: formatContentForAnthropic(m.content),
      }));

    // Build system parameter — optionally with prompt caching
    let systemParam: string | Array<{ type: string; text: string; cache_control?: { type: string } }> | undefined;
    if (systemMsg) {
      if (options?.cacheSystem) {
        systemParam = [{
          type: 'text',
          text: systemMsg,
          cache_control: { type: 'ephemeral' },
        }];
      } else {
        systemParam = systemMsg;
      }
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model: this.config.model || 'claude-sonnet-4-20250514',
          max_tokens: options?.maxTokens ?? 4096,
          ...(systemParam ? { system: systemParam as any } : {}),
          messages: nonSystemMessages as any,
        });

        const textBlock = response.content.find(b => b.type === 'text');
        const rawUsage = response.usage as any;
        return {
          content: textBlock?.text ?? '',
          usage: {
            inputTokens: rawUsage?.input_tokens || 0,
            outputTokens: rawUsage?.output_tokens || 0,
            cacheWriteTokens: rawUsage?.cache_creation_input_tokens || 0,
            cacheReadTokens: rawUsage?.cache_read_input_tokens || 0,
          },
        };
      } catch (err: any) {
        const classified = classifyError(err);
        if (classified.retryable && attempt < MAX_RETRIES) {
          const delay = classified.retryAfterMs ?? getRetryDelay(attempt, null);
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

    const systemContent = messages.find(m => m.role === 'system')?.content;
    const systemMsg = options?.system ?? (typeof systemContent === 'string' ? systemContent : undefined);
    const nonSystemMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: formatContentForAnthropic(m.content),
      }));

    // Build system parameter — optionally with prompt caching (same logic as chat())
    let streamSystemParam: string | Array<{ type: string; text: string; cache_control?: { type: string } }> | undefined;
    if (systemMsg) {
      if (options?.cacheSystem) {
        streamSystemParam = [{
          type: 'text',
          text: systemMsg,
          cache_control: { type: 'ephemeral' },
        }];
      } else {
        streamSystemParam = systemMsg;
      }
    }

    const stream = client.messages.stream({
      model: this.config.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens ?? 4096,
      ...(streamSystemParam ? { system: streamSystemParam as any } : {}),
      messages: nonSystemMessages as any,
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
          messages: allMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })) as any,
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
        const classified = classifyError(err);
        if (classified.retryable && attempt < MAX_RETRIES) {
          const delay = classified.retryAfterMs ?? getRetryDelay(attempt, null);
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
      messages: allMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })) as any,
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
    const modelName = this.config.model || 'anthropic/claude-sonnet-4';
    const isAnthropic = modelName.startsWith('anthropic/');

    // For Anthropic models via OpenRouter, support prompt caching on system message
    let allMessages: Array<{ role: string; content: any }>;
    if (options?.system && options.cacheSystem && isAnthropic) {
      allMessages = [
        {
          role: 'system' as const,
          content: [{
            type: 'text',
            text: options.system,
            cache_control: { type: 'ephemeral' },
          }],
        },
        ...messages.filter(m => m.role !== 'system'),
      ];
    } else if (options?.system) {
      allMessages = [
        { role: 'system' as const, content: options.system },
        ...messages.filter(m => m.role !== 'system'),
      ];
    } else {
      allMessages = [...messages];
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: modelName,
          max_tokens: options?.maxTokens ?? 4096,
          messages: allMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content : JSON.stringify(m.content)) })) as any,
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
        const classified = classifyError(err);
        if (classified.retryable && attempt < MAX_RETRIES) {
          const delay = classified.retryAfterMs ?? getRetryDelay(attempt, null);
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
      messages: allMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })) as any,
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
 * Ollama provider — uses the local Ollama server for free LLM inference.
 * No API key needed. Default endpoint: http://localhost:11434
 * Default model: llama3.2 (small, fast, good for Q&A)
 */
class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: LLMConfig) {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    // Ollama must point to localhost — block remote endpoints to prevent sending prompts to untrusted servers
    try {
      const parsed = new URL(baseUrl);
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]') {
        throw new Error('Ollama baseUrl must be localhost. Remote Ollama endpoints are not supported.');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('Ollama baseUrl')) throw e;
      throw new Error('Invalid Ollama baseUrl');
    }
    this.baseUrl = baseUrl;
    this.model = config.model || 'llama3.2';
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const body = {
      model: this.model,
      messages: this.formatMessages(messages, options?.system),
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096,
      },
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000), // 2 min timeout for local models
        });

        if (!response.ok) {
          throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json() as any;
        return {
          content: result.message?.content || '',
          usage: {
            inputTokens: result.prompt_eval_count || 0,
            outputTokens: result.eval_count || 0,
          },
        };
      } catch (err: any) {
        if (attempt < MAX_RETRIES && (err.name === 'AbortError' || err.message?.includes('ECONNREFUSED'))) {
          const delay = getRetryDelay(attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw sanitizeError(err, 'Ollama');
      }
    }
    throw new Error('Unreachable');
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const body = {
      model: this.model,
      messages: this.formatMessages(messages, options?.system),
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 4096,
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    let accumulated = '';
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from Ollama');

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      // Ollama streams one JSON object per line
      for (const line of text.split('\n').filter(l => l.trim())) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            accumulated += parsed.message.content;
            yield { delta: parsed.message.content, snapshot: accumulated };
          }
        } catch { /* skip malformed lines */ }
      }
    }
  }

  private formatMessages(messages: LLMMessage[], system?: string): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];
    if (system) {
      result.push({ role: 'system', content: system });
    }
    for (const msg of messages) {
      if (typeof msg.content !== 'string') {
        throw new Error('Ollama does not support image content. Use Claude or GPT-4o.');
      }
      result.push({ role: msg.role, content: msg.content });
    }
    return result;
  }
}
