import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * One `mongod` for the whole integration run, shared by every worker.
 *
 * Each file used to call `MongoMemoryServer.create()` itself. That races:
 * mongodb-memory-server picks a free port by opening a socket, closing it, and
 * then starting mongod on it, so two workers starting at once can be handed the
 * same port — and the loser silently connects to the winner's database. The
 * failures never looked like a race (a stray 404, a field reading back
 * `undefined`) and never reproduced on a single file.
 *
 * Booting once here and giving each file its own `dbName` (see
 * `connectToTestDb`) removes the collision by construction, and boots one
 * mongod instead of seven.
 */
let mongo: MongoMemoryServer | undefined;

export async function setup(project: TestProject) {
  mongo = await MongoMemoryServer.create();
  project.provide('mongoUri', mongo.getUri());
}

export async function teardown() {
  await mongo?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
