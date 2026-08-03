import type { DatabaseSync } from "node:sqlite";

export interface DatabaseMigration {
  version: number;
  name: string;
  sql: string;
}

interface MigrationRow {
  version: number;
  name: string;
}

export class MigrationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationRequiredError";
  }
}

export function applyMigrations(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[]
): number[] {
  validateMigrationList(migrations);
  ensureMigrationTable(database);
  const appliedRows = readAppliedMigrations(database);
  validateAppliedMigrations(appliedRows, migrations);
  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const newlyApplied: number[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT;");
      newlyApplied.push(migration.version);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  return newlyApplied;
}

export function assertMigrationsCurrent(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[]
): void {
  validateMigrationList(migrations);
  if (!migrationTableExists(database)) {
    throw new MigrationRequiredError("Database migrations have not been applied.");
  }
  const appliedRows = readAppliedMigrations(database);
  validateAppliedMigrations(appliedRows, migrations);
  if (appliedRows.length !== migrations.length) {
    const currentVersion = appliedRows.at(-1)?.version ?? 0;
    const requiredVersion = migrations.at(-1)?.version ?? 0;
    throw new MigrationRequiredError(
      `Database migration version ${currentVersion} does not match required version ${requiredVersion}.`
    );
  }
}

function ensureMigrationTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function migrationTableExists(database: DatabaseSync): boolean {
  const row = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("schema_migrations") as { found: number } | undefined;
  return row?.found === 1;
}

function readAppliedMigrations(database: DatabaseSync): MigrationRow[] {
  return database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as unknown as MigrationRow[];
}

function validateMigrationList(migrations: readonly DatabaseMigration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(`Migration versions must be continuous. Expected ${expectedVersion}.`);
    }
    if (!migration.name.trim() || !migration.sql.trim()) {
      throw new Error(`Migration ${migration.version} must have a name and SQL.`);
    }
  }
}

function validateAppliedMigrations(
  appliedRows: readonly MigrationRow[],
  migrations: readonly DatabaseMigration[]
): void {
  for (const [index, row] of appliedRows.entries()) {
    if (row.version !== index + 1) {
      throw new MigrationRequiredError(
        `Applied migration versions are not continuous at version ${row.version}.`
      );
    }
    const migration = migrations[row.version - 1];
    if (!migration || migration.name !== row.name) {
      throw new MigrationRequiredError(
        `Unknown or changed database migration: ${row.version} (${row.name}).`
      );
    }
  }
}
