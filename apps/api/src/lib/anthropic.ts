import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { AppError } from './AppError';

/**
 * The one Anthropic client, built lazily like the S3 client in media — an
 * install without a key still boots, and the routes that would spend money
 * answer 503 instead. Callers check their own feature flag
 * (`env.translationEnabled` / `env.aiDraftingEnabled`) before calling this;
 * the key check here is the backstop.
 *
 * Model id always comes from `env.llmModel` — never hardcode one.
 */

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new AppError('AI features are not configured on this server', 503);
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return client;
}
