import mongoose from 'mongoose';
import { env } from './env';

export async function connectDb(): Promise<void> {
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(env.mongoUri);
    console.log('Connected to MongoDB');
    // Sync indexes so schema changes take effect automatically. Non-fatal — a
    // sync failure logs a warning but does not prevent the server from starting.
    mongoose.syncIndexes().catch((err: unknown) => {
      console.warn('Index sync failed (non-fatal):', err instanceof Error ? err.message : err);
    });
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    throw error;
  }
}
