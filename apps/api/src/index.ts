import { app } from './app';
import { env } from './config/env';
import { connectDb } from './config/db';

async function start(): Promise<void> {
  await connectDb();
  const server = app.listen(env.port, () => {
    console.log(`API listening on port ${env.port}`);
  });

  // Node's default requestTimeout (5 min) caps how long a request body may
  // take to arrive — a training video on slow kitchen wifi can legitimately
  // need longer. 30 min still bounds a stalled connection; headersTimeout
  // keeps its strict default, so slowloris-style header dribbling dies fast.
  server.requestTimeout = 30 * 60 * 1000;
}

start().catch((error: unknown) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
