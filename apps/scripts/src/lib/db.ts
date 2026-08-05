import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

/**
 * Scripts fall back to the API's own .env so there is only ever one place to
 * put the connection string.
 */
function loadEnv(): void {
  dotenv.config();
  if (!process.env.MONGO_CONNECTION_STRING) {
    const apiEnv = resolve(import.meta.dirname, '../../../api/.env');
    if (existsSync(apiEnv)) dotenv.config({ path: apiEnv });
  }
}

export async function connect(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGO_CONNECTION_STRING;
  if (!uri) {
    throw new Error('MONGO_CONNECTION_STRING is not set (checked .env and apps/api/.env)');
  }
  await mongoose.connect(uri);
}

export async function disconnect(): Promise<void> {
  await mongoose.disconnect();
}

/** Wraps a script body with connect/disconnect and a non-zero exit on failure. */
export async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await connect();
    await fn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}
