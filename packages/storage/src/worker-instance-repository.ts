import type { WorkerInstanceSnapshot, WorkerKind } from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface WorkerInstanceRow {
  id: string;
  kind: WorkerKind;
  version: string;
  pid: number | null;
  started_at: string;
  heartbeat_at: string;
  stopped_at: string | null;
}

export interface RegisterWorkerInput {
  id: string;
  kind: WorkerKind;
  version: string;
  pid?: number | null;
}

export class WorkerInstanceRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  register(input: RegisterWorkerInput): WorkerInstanceSnapshot {
    const id = requireText(input.id, "Worker ID");
    const version = requireText(input.version, "Worker version");
    validateWorkerKind(input.kind);
    if (input.pid !== undefined && input.pid !== null && (!Number.isInteger(input.pid) || input.pid < 1)) {
      throw new Error("Worker PID must be a positive integer.");
    }
    const existing = this.findById(id);
    if (existing && existing.stoppedAt === null) {
      throw new Error(`Worker ${id} is already registered.`);
    }
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(`
        INSERT INTO worker_instances (
          id, kind, version, pid, started_at, heartbeat_at, stopped_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          version = excluded.version,
          pid = excluded.pid,
          started_at = excluded.started_at,
          heartbeat_at = excluded.heartbeat_at,
          stopped_at = NULL
      `)
      .run(id, input.kind, version, input.pid ?? null, now, now);
    return this.requireById(id);
  }

  heartbeat(workerId: string): WorkerInstanceSnapshot {
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE worker_instances SET heartbeat_at = ?
        WHERE id = ? AND stopped_at IS NULL
      `)
      .run(now, workerId);
    if (result.changes !== 1) throw new Error(`Active worker not found: ${workerId}`);
    return this.requireById(workerId);
  }

  stop(workerId: string): WorkerInstanceSnapshot {
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE worker_instances SET heartbeat_at = ?, stopped_at = ?
        WHERE id = ? AND stopped_at IS NULL
      `)
      .run(now, now, workerId);
    if (result.changes !== 1) throw new Error(`Active worker not found: ${workerId}`);
    return this.requireById(workerId);
  }

  findById(workerId: string): WorkerInstanceSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, kind, version, pid, started_at, heartbeat_at, stopped_at
        FROM worker_instances WHERE id = ?
      `)
      .get(workerId) as WorkerInstanceRow | undefined;
    return row ? mapWorker(row) : null;
  }

  requireById(workerId: string): WorkerInstanceSnapshot {
    const worker = this.findById(workerId);
    if (!worker) throw new Error(`Worker not found: ${workerId}`);
    return worker;
  }

  listActive(kind?: WorkerKind): WorkerInstanceSnapshot[] {
    if (kind !== undefined) validateWorkerKind(kind);
    const rows = (kind === undefined
      ? this.#database.connection
          .prepare(`
            SELECT id, kind, version, pid, started_at, heartbeat_at, stopped_at
            FROM worker_instances WHERE stopped_at IS NULL ORDER BY heartbeat_at DESC, id
          `)
          .all()
      : this.#database.connection
          .prepare(`
            SELECT id, kind, version, pid, started_at, heartbeat_at, stopped_at
            FROM worker_instances
            WHERE stopped_at IS NULL AND kind = ?
            ORDER BY heartbeat_at DESC, id
          `)
          .all(kind)) as unknown as WorkerInstanceRow[];
    return rows.map(mapWorker);
  }

  isReady(kind: WorkerKind, requiredVersion: string, heartbeatCutoff: string): boolean {
    validateWorkerKind(kind);
    const version = requireText(requiredVersion, "Required worker version");
    const row = this.#database.connection
      .prepare(`
        SELECT 1 AS ready
        FROM worker_instances
        WHERE stopped_at IS NULL
          AND kind IN (?, 'combined')
          AND version = ?
          AND heartbeat_at >= ?
        LIMIT 1
      `)
      .get(kind, version, heartbeatCutoff) as { ready: number } | undefined;
    return row?.ready === 1;
  }
}

function mapWorker(row: WorkerInstanceRow): WorkerInstanceSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    pid: row.pid,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    stoppedAt: row.stopped_at
  };
}

function validateWorkerKind(kind: WorkerKind): void {
  if (kind !== "combined" && kind !== "agent" && kind !== "image" && kind !== "model") {
    throw new Error("Worker kind is invalid.");
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
