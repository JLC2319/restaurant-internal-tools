import rateLimit from 'express-rate-limit';

const skipInTests = () => process.env.NODE_ENV === 'test';

/**
 * Applied to login and registration to blunt brute-force and account spam.
 * Per-IP, so a whole kitchen signing in from one Wi-Fi network on shift change
 * shares a bucket — keep the limit generous enough to survive that.
 * 20 requests per IP per 15-minute window.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again after 15 minutes.' },
  skip: skipInTests,
});

/**
 * Applied to password-reset email sending. Tighter than login because each
 * request sends mail on someone else's behalf.
 * 5 requests per IP per 15-minute window.
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many password reset attempts, please try again after 15 minutes.' },
  skip: skipInTests,
});

/**
 * Applied to media upload endpoints (plating photos, training video).
 * 30 uploads per IP per 30-minute window — a chef photographing a full menu
 * rewrite in one sitting must not trip it.
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many uploads, please try again shortly.' },
  skip: skipInTests,
});

/**
 * Applied to any endpoint that triggers a paid LLM call — machine translation
 * above all. This is a cost control as much as abuse protection, and it is the
 * reason translation is requested per document rather than per field.
 * 60 requests per IP per 60-minute window.
 */
export const llmRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many translation requests, please try again later.' },
  skip: skipInTests,
});
