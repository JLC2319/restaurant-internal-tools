import dotenv from 'dotenv';
dotenv.config();

const requiredEnvVars = ['MONGO_CONNECTION_STRING', 'JWT_SECRET'] as const;

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

/**
 * How many reverse proxies sit in front of this app, for Express's `trust proxy`.
 *
 * This drives `req.ip`, which every rate limiter keys on. Getting it wrong
 * breaks them in one of two directions:
 *
 * - Unset (Express default): `req.ip` is the *proxy's* address for every
 *   request, so all callers share one bucket and 10 failed logins lock out
 *   every location in the group.
 * - `true`: Express takes the left-most `X-Forwarded-For` entry, which is fully
 *   client-controlled — an attacker sends a new fake IP per request and never
 *   hits a limit.
 *
 * A hop *count* avoids both: Express walks that many entries in from the right,
 * and the right-most entry is the one our own edge proxy appended.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const value = raw?.trim();
  if (!value) return 1;
  if (value === 'true') return true;
  if (value === 'false') return false;

  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;

  // Otherwise treat it as an explicit allow-list of proxy IPs/CIDRs.
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  port: process.env.PORT ?? '8888',
  mongoUri: process.env.MONGO_CONNECTION_STRING as string,
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  webUrl: (process.env.WEB_URL ?? 'http://localhost:4321').replace(/\/$/, ''),

  // Anthropic — LLM translation of recipes and training content. The feature is
  // on whenever a key is present; TRANSLATION_ENABLED=false force-disables it
  // without having to pull the key out of the deployment.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'claude-sonnet-5',
  translationEnabled:
    Boolean(process.env.ANTHROPIC_API_KEY) && process.env.TRANSLATION_ENABLED !== 'false',

  // Cloudflare R2 — plating photos and training media.
  r2AccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  r2BucketName: process.env.R2_BUCKET_NAME ?? '',
  r2PublicUrl: (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, ''),
};
