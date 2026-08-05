import { app } from './app';
import { env } from './config/env';
import { connectDb } from './config/db';

async function start(): Promise<void> {
  await connectDb();
  app.listen(env.port, () => {
    console.log(`API listening on port ${env.port}`);
  });
}

start().catch((error: unknown) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
