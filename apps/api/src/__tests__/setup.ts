// Set required env vars before any module imports so that env.ts doesn't throw.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.TRANSLATION_ENABLED = 'false';
process.env.ANTHROPIC_API_KEY = '';

// Media storage: dummy but complete, so `isMediaConfigured()` is true and the
// upload routes are reachable. Tests that exercise an upload mock the S3
// client itself — nothing here ever talks to Cloudflare.
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.R2_PUBLIC_URL = 'https://media.test.local';
