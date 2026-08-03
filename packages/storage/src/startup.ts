import { LyraDatabase } from "./database.js";
import { applyMigrations, assertMigrationsCurrent } from "./migration-runner.js";
import { lyraMigrations } from "./migrations/index.js";
import { ensureRuntimeLayout, type RuntimeLayout } from "./runtime-layout.js";

export async function migrateRuntimeDatabase(layout: RuntimeLayout): Promise<number[]> {
  await ensureRuntimeLayout(layout);
  const database = new LyraDatabase(layout.databaseFile);
  try {
    return applyMigrations(database.connection, lyraMigrations);
  } finally {
    database.close();
  }
}

export async function openReadyRuntimeDatabase(layout: RuntimeLayout): Promise<LyraDatabase> {
  await ensureRuntimeLayout(layout);
  const database = new LyraDatabase(layout.databaseFile);
  try {
    assertMigrationsCurrent(database.connection, lyraMigrations);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
