import mongoose from 'mongoose';
import { inject } from 'vitest';

/**
 * Connect this test file to its own database on the shared mongod that
 * `globalSetup.ts` booted.
 *
 * The database name must be unique per file: files run in parallel workers, and
 * sharing one database would let a document created by one file be visible to —
 * or dropped by — another.
 */
export async function connectToTestDb(dbName: string): Promise<void> {
  await mongoose.connect(inject('mongoUri'), { dbName });
}

/** Drop this file's database and disconnect. Pair with `connectToTestDb`. */
export async function disconnectTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
