import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './features/auth/auth.router';
import { tenancyRouter } from './features/tenancy/tenancy.router';

const app = express();

// Must be set before any middleware that reads `req.ip` — every rate limiter
// keys on it, and behind a proxy it is the proxy's address unless we say how
// many hops to trust. See parseTrustProxy in config/env.ts.
app.set('trust proxy', env.trustProxy);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, native app shells).
      if (!origin) return callback(null, true);
      // Allow any localhost origin regardless of port.
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    // The tenant scope travels in headers, so they must survive preflight.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id', 'X-Property-Id', 'X-Location-Id'],
  })
);
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

// Health check — used by the platform's uptime probe.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'rit-api' });
});

// ── Feature routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/tenancy', tenancyRouter);

// Phase 1 feature routers mount here as they are built. Each one goes behind
// `authenticate` + `resolveTenant` — see apps/api/src/features/*/README.md.
//   app.use('/api/recipes', recipeRouter);
//   app.use('/api/training', trainingRouter);
//   app.use('/api/translations', translationRouter);
//   app.use('/api/allergens', allergenRouter);
//   app.use('/api/rd-bank', rdBankRouter);
//   app.use('/api/media', mediaRouter);

// Error handling (must be last).
app.use(notFound);
app.use(errorHandler);

export { app };
