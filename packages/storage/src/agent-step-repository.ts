import { randomUUID } from "node:crypto";
import type {
  AgentStepSnapshot,
  AgentStepStatus,
  AgentStepType
} from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface AgentStepRow {
  id: string;
  agent_run_id: string;
  sequence: number;
  type: AgentStepType;
  status: AgentStepStatus;
  tool_name: string | null;
  payload_json: string;
  child_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppendAgentStepInput {
  agentRunId: string;
  type: AgentStepType;
  status: AgentStepStatus;
  toolName?: string | null;
  payload?: Record<string, unknown>;
  childJobId?: string | null;
}

export interface ResumableToolStep {
  step: AgentStepSnapshot;
  jobId: string;
  jobStatus: "succeeded" | "failed" | "cancelled" | "interrupted";
}

export class AgentStepRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  append(input: AppendAgentStepInput): AgentStepSnapshot {
    return this.#database.transaction(() => {
      const sequenceRow = this.#database.connection
        .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_steps WHERE agent_run_id = ?")
        .get(input.agentRunId) as { sequence: number };
      const now = new Date().toISOString();
      const id = randomUUID();
      const payload = structuredClone(input.payload ?? {});
      this.#database.connection
        .prepare(`
          INSERT INTO agent_steps (
            id, agent_run_id, sequence, type, status, tool_name,
            payload_json, child_job_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.agentRunId,
          sequenceRow.sequence,
          input.type,
          input.status,
          input.toolName ?? null,
          JSON.stringify(payload),
          input.childJobId ?? null,
          now,
          now
        );
      this.#database.connection
        .prepare("UPDATE agent_runs SET current_step = ?, updated_at = ? WHERE id = ?")
        .run(sequenceRow.sequence, now, input.agentRunId);
      return {
        id,
        agentRunId: input.agentRunId,
        sequence: sequenceRow.sequence,
        type: input.type,
        status: input.status,
        toolName: input.toolName ?? null,
        payload,
        childJobId: input.childJobId ?? null,
        createdAt: now,
        updatedAt: now
      };
    });
  }

  findById(stepId: string): AgentStepSnapshot | null {
    const row = this.#database.connection
      .prepare(`${STEP_SELECT} WHERE id = ?`)
      .get(stepId) as AgentStepRow | undefined;
    return row ? mapStep(row) : null;
  }

  list(agentRunId: string): AgentStepSnapshot[] {
    const rows = this.#database.connection
      .prepare(`${STEP_SELECT} WHERE agent_run_id = ? ORDER BY sequence`)
      .all(agentRunId) as unknown as AgentStepRow[];
    return rows.map(mapStep);
  }

  findToolCall(agentRunId: string, toolCallId: string): AgentStepSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        ${STEP_SELECT}
        WHERE agent_run_id = ? AND type = 'tool_call'
          AND json_extract(payload_json, '$.toolCallId') = ?
        ORDER BY sequence DESC LIMIT 1
      `)
      .get(agentRunId, toolCallId) as AgentStepRow | undefined;
    return row ? mapStep(row) : null;
  }

  update(
    stepId: string,
    input: {
      status?: AgentStepStatus;
      payload?: Record<string, unknown>;
      childJobId?: string | null;
    }
  ): AgentStepSnapshot {
    const existing = this.findById(stepId);
    if (!existing) throw new Error(`Agent step not found: ${stepId}`);
    const status = input.status ?? existing.status;
    const payload = structuredClone(input.payload ?? existing.payload);
    const childJobId = input.childJobId === undefined ? existing.childJobId : input.childJobId;
    const updatedAt = new Date().toISOString();
    this.#database.connection
      .prepare(`
        UPDATE agent_steps
        SET status = ?, payload_json = ?, child_job_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, JSON.stringify(payload), childJobId, updatedAt, stepId);
    return { ...existing, status, payload, childJobId, updatedAt };
  }

  saveToolCheckpoint(
    agentRunId: string,
    toolCallId: string,
    childJobId: string,
    checkpoint: Record<string, unknown>
  ): AgentStepSnapshot {
    const step = this.findToolCall(agentRunId, toolCallId);
    if (!step) throw new Error(`Agent tool call step not found: ${toolCallId}`);
    return this.update(step.id, {
      status: "waiting",
      childJobId,
      payload: { ...step.payload, checkpoint: structuredClone(checkpoint) }
    });
  }

  saveUserInputCheckpoint(
    agentRunId: string,
    toolCallId: string,
    request: Record<string, unknown>,
    checkpoint: Record<string, unknown>
  ): AgentStepSnapshot {
    const toolStep = this.findToolCall(agentRunId, toolCallId);
    if (!toolStep) throw new Error(`Agent tool call step not found: ${toolCallId}`);
    this.update(toolStep.id, { status: "waiting" });
    return this.append({
      agentRunId,
      type: "user_input_request",
      status: "waiting",
      toolName: toolStep.toolName,
      payload: {
        toolCallId,
        request: structuredClone(request),
        checkpoint: structuredClone(checkpoint)
      }
    });
  }

  findWaitingUserInput(agentRunId: string): AgentStepSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        ${STEP_SELECT}
        WHERE agent_run_id = ? AND type = 'user_input_request' AND status = 'waiting'
        ORDER BY sequence DESC LIMIT 1
      `)
      .get(agentRunId) as AgentStepRow | undefined;
    return row ? mapStep(row) : null;
  }

  listResumableTools(limit = 100): ResumableToolStep[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Resumable Agent step limit must be between 1 and 500.");
    }
    const rows = this.#database.connection
      .prepare(`
        SELECT s.id, s.agent_run_id, s.sequence, s.type, s.status, s.tool_name,
               s.payload_json, s.child_job_id, s.created_at, s.updated_at,
               j.status AS job_status
        FROM agent_steps s
        JOIN agent_runs r ON r.id = s.agent_run_id
        JOIN jobs j ON j.id = s.child_job_id
        WHERE r.status = 'waiting_tool'
          AND s.type = 'tool_call'
          AND s.status = 'waiting'
          AND j.status IN ('succeeded', 'failed', 'cancelled', 'interrupted')
        ORDER BY r.created_at, s.sequence
        LIMIT ?
      `)
      .all(limit) as unknown as Array<
        AgentStepRow & { job_status: ResumableToolStep["jobStatus"] }
      >;
    return rows.map((row) => ({
      step: mapStep(row),
      jobId: row.child_job_id!,
      jobStatus: row.job_status
    }));
  }
}

const STEP_SELECT = `
  SELECT id, agent_run_id, sequence, type, status, tool_name,
         payload_json, child_job_id, created_at, updated_at
  FROM agent_steps
`;

function mapStep(row: AgentStepRow): AgentStepSnapshot {
  const payload: unknown = JSON.parse(row.payload_json);
  if (!isRecord(payload)) throw new Error(`Agent step payload is invalid: ${row.id}`);
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    sequence: row.sequence,
    type: row.type,
    status: row.status,
    toolName: row.tool_name,
    payload,
    childJobId: row.child_job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
