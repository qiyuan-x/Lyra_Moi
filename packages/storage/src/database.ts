import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OpenDatabaseOptions {
  busyTimeoutMs?: number;
}

export class LyraDatabase {
  readonly connection: DatabaseSync;
  readonly path: string;
  projectIndexWriter: ((projectId: string) => void) | undefined;
  private readonly changedProjects = new Set<string>();

  constructor(databasePath: string, options: OpenDatabaseOptions = {}) {
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new Error("busyTimeoutMs must be a non-negative integer.");
    }

    this.path = databasePath === ":memory:" ? databasePath : resolve(databasePath);
    if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
    this.connection = new DatabaseSync(this.path);
    this.connection.exec("PRAGMA foreign_keys = ON;");
    this.connection.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
    if (this.path !== ":memory:") {
      execWithBusyRetry(this.connection, "PRAGMA journal_mode = WAL;");
      execWithBusyRetry(this.connection, "PRAGMA synchronous = NORMAL;");
    }
  }

  transaction<T>(work: () => T): T {
    if (this.connection.isTransaction) return work();
    this.connection.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.connection.exec("COMMIT;");
      this.flushProjectIndexes();
      return result;
    } catch (error) {
      if (this.connection.isTransaction) this.connection.exec("ROLLBACK;");
      this.changedProjects.clear();
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }

  projectChanged(projectId: string): void {
    if (!this.projectIndexWriter) return;
    this.changedProjects.add(projectId);
    if (!this.connection.isTransaction) this.flushProjectIndexes();
  }

  private flushProjectIndexes(): void {
    const ids = [...this.changedProjects];
    this.changedProjects.clear();
    for (const id of ids) {
      // A portable-index failure must not turn a committed business operation into a retry.
      try { this.projectIndexWriter?.(id); }
      catch (error) { console.error(`Project index write failed: ${id}`, error); }
    }
  }
}

function execWithBusyRetry(connection: DatabaseSync, sql: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      connection.exec(sql);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code ?? "")
        : "";
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const retryable = code === "ERR_SQLITE_BUSY" || code === "ERR_SQLITE_LOCKED" || message.includes("database is locked");
      if (!retryable || attempt >= 20) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(250, 25 * (attempt + 1)));
    }
  }
}
