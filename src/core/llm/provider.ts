import type { LLMConfig, LLMMessage, LLMResponse } from '../types.js';

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** System prompt — handled differently per provider */
  system?: string;
}

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
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
  }
}
