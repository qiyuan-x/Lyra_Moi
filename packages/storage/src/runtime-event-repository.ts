import type { RuntimeEventSnapshot } from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface RuntimeEventRow {
  id: number;
  project_id: string;
  conversation_id: string | null;
  agent_run_id: string | null;
  job_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

export interface AppendRuntimeEventInput {
  projectId: string;
  conversationId?: string | null;
  agentRunId?: string | null;
  jobId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export interface RuntimeEventQuery {
  projectId: string;
  afterId?: number;
  conversationId?: string;
  agentRunId?: string;
  jobId?: string;
  limit?: number;
}

export class RuntimeEventRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  append(input: AppendRuntimeEventInput): RuntimeEventSnapshot {
    const type = input.type.trim();
    if (!type) throw new Error("Runtime event type is required.");
    const createdAt = input.createdAt ?? new Date().toISOString();
    const payload = structuredClone(input.payload ?? {});
    const result = this.#database.connection
      .prepare(`
        INSERT INTO runtime_events (
          project_id, conversation_id, agent_run_id, job_id, type, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.projectId,
        input.conversationId ?? null,
        input.agentRunId ?? null,
        input.jobId ?? null,
        type,
        JSON.stringify(payload),
        createdAt
      );
    return {
      id: Number(result.lastInsertRowid),
      projectId: input.projectId,
      conversationId: input.conversationId ?? null,
      agentRunId: input.agentRunId ?? null,
      jobId: input.jobId ?? null,
      type,
      payload,
      createdAt
    };
  }

  appendBatch(inputs: readonly AppendRuntimeEventInput[]): RuntimeEventSnapshot[] {
    if (inputs.length === 0) return [];
    const write = () => inputs.map((input) => this.append(input));
    return this.#database.connection.isTransaction ? write() : this.#database.transaction(write);
  }

  list(query: RuntimeEventQuery): RuntimeEventSnapshot[] {
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Runtime event limit must be an integer between 1 and 500.");
    }
    const afterId = query.afterId ?? 0;
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
      throw new Error("Runtime event cursor must be a non-negative safe integer.");
    }
    const where = ["project_id = ?", "id > ?"];
    const parameters: Array<string | number> = [query.projectId, afterId];
    for (const [column, value] of [
      ["conversation_id", query.conversationId],
      ["agent_run_id", query.agentRunId],
      ["job_id", query.jobId]
    ] as const) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        parameters.push(value);
      }
    }
    parameters.push(limit);
    const rows = this.#database.connection
      .prepare(`
        SELECT id, project_id, conversation_id, agent_run_id, job_id,
               type, payload_json, created_at
        FROM runtime_events
        WHERE ${where.join(" AND ")}
        ORDER BY id
        LIMIT ?
      `)
      .all(...parameters) as unknown as RuntimeEventRow[];
    return rows.map(mapRuntimeEvent);
  }
}

function mapRuntimeEvent(row: RuntimeEventRow): RuntimeEventSnapshot {
  const payload: unknown = JSON.parse(row.payload_json);
  if (!isRecord(payload)) throw new Error(`Runtime event ${row.id} has an invalid payload.`);
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    agentRunId: row.agent_run_id,
    jobId: row.job_id,
    type: row.type,
    payload,
    createdAt: row.created_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
