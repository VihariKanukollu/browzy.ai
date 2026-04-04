/**
 * Smart error classification for browzy.ai.
 * Turns raw API errors into friendly, actionable messages.
 */

export type ErrorCategory = 'rate_limit' | 'auth' | 'network' | 'server' | 'content_policy' | 'budget' | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  userMessage: string;
  retryable: boolean;
  retryAfterMs?: number;
  action?: 'wait' | 'reprompt_key' | 'retry' | 'show_message';
}

export function classifyError(err: any): ClassifiedError {
  const message = (err.message ?? '').toLowerCase();
  const status: number = err.status ?? err.statusCode ?? 0;

  // Rate limiting
  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    const retryAfter = err.headers?.get?.('retry-after') ?? err.headers?.['retry-after'];
    const waitMs = retryAfter ? parseInt(String(retryAfter), 10) * 1000 : 30_000;
    return {
      category: 'rate_limit',
      userMessage: 'Rate limited. Retries exhausted \u2014 try again in a moment.',
      retryable: true,
      retryAfterMs: waitMs,
      action: 'wait',
    };
  }

  // Auth failures
  if (
    status === 401 || status === 403 ||
    message.includes('invalid api key') ||
    message.includes('invalid x-api-key') ||
    message.includes('unauthorized') ||
    message.includes('authentication') ||
    message.includes('permission denied')
  ) {
    return {
      category: 'auth',
      userMessage: 'API key is invalid or expired. Paste a new key:',
      retryable: false,
      action: 'reprompt_key',
    };
  }

  // Network errors
  if (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('socket hang up') ||
    message.includes('dns')
  ) {
    return {
      category: 'network',
      userMessage: "Can't reach the API. Check your internet connection and try again.",
      retryable: true,
      retryAfterMs: 5000,
      action: 'retry',
    };
  }

  // Server errors
  if (status >= 500 || message.includes('internal server error') || message.includes('overloaded') || message.includes('service unavailable')) {
    return {
      category: 'server',
      userMessage: 'The AI service was temporarily overloaded. Retries exhausted \u2014 try again shortly.',
      retryable: true,
      retryAfterMs: 10_000,
      action: 'retry',
    };
  }

  // Content policy
  if (message.includes('content policy') || message.includes('safety') || message.includes('harmful') || message.includes('content filter')) {
    return {
      category: 'content_policy',
      userMessage: 'This query was flagged by content filters. Try rephrasing.',
      retryable: false,
      action: 'show_message',
    };
  }

  // Budget / quota
  if (message.includes('quota') || message.includes('billing') || message.includes('insufficient') || message.includes('exceeded')) {
    return {
      category: 'budget',
      userMessage: 'API quota or billing limit reached. Check your account.',
      retryable: false,
      action: 'show_message',
    };
  }

  // Unknown
  return {
    category: 'unknown',
    userMessage: `Something went wrong: ${err.message || 'Unknown error'}`,
    retryable: false,
    action: 'show_message',
  };
}
