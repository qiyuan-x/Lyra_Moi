import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OpenDatabaseOptions {
  busyTimeoutMs?: number;
}

export class LyraDatabase {
  readonly connection: DatabaseSync;
  readonly path: string;

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
      this.connection.exec("PRAGMA journal_mode = WAL;");
      this.connection.exec("PRAGMA synchronous = NORMAL;");
    }
  }

  transaction<T>(work: () => T): T {
    if (this.connection.isTransaction) return work();
    this.connection.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.connection.exec("COMMIT;");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK;");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
