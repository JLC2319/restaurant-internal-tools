// Set required env vars before any module imports so that env.ts doesn't throw.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.TRANSLATION_ENABLED = 'false';
process.env.ANTHROPIC_API_KEY = '';
