import type { AgentRunSnapshot, AgentRunStatus } from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";
import { RuntimeEventRepository } from "./runtime-event-repository.js";
import { randomUUID } from "node:crypto";

interface AgentRunRow {
  id: string;
  project_id: string;
  conversation_id: string;
  request_message_id: string;
  status: AgentRunStatus;
  llm_provider_profile_id: string;
  llm_provider_model_id: string;
  default_image_profile_id: string | null;
  default_image_model_id: string | null;
  optimize_image_prompt: number;
  system_prompt_version: string;
  max_tool_calls: number;
  tool_call_count: number;
  current_step: number;
  cancel_requested: number;
  locked_by: string | null;
  locked_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StoredAgentRun extends AgentRunSnapshot {
  llmProviderProfileId: string;
  llmProviderModelId: string;
  defaultImageProfileId: string | null;
  defaultImageModelId: string | null;
  optimizeImagePrompt: boolean;
  systemPromptVersion: string;
  maxToolCalls: number;
  lockedBy: string | null;
  lockedAt: string | null;
}

export interface CreateAgentRunInput {
  projectId: string;
  conversationId: string;
  requestMessageId: string;
  llmProviderProfileId: string;
  llmProviderModelId: string;
  defaultImageProfileId?: string | null;
  defaultImageModelId?: string | null;
  optimizeImagePrompt?: boolean;
  systemPromptVersion: string;
  maxToolCalls?: number;
}

export class AgentRunNotFoundError extends Error {
  constructor(agentRunId: string) {
    super(`Agent run not found: ${agentRunId}`);
    this.name = "AgentRunNotFoundError";
  }
}

export class AgentRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunTransitionError";
  }
}

export class AgentRunRepository {
  readonly #database: LyraDatabase;
  readonly #events: RuntimeEventRepository;

  constructor(database: LyraDatabase, events = new RuntimeEventRepository(database)) {
    this.#database = database;
    this.#events = events;
  }

  create(input: CreateAgentRunInput): AgentRunSnapshot {
    const now = new Date().toISOString();
    const id = randomUUID();
    const maxToolCalls = input.maxToolCalls ?? 10;
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 100) {
      throw new Error("Agent maxToolCalls must be an integer between 1 and 100.");
    }
    this.#database.connection
      .prepare(`
        INSERT INTO agent_runs (
          id, project_id, conversation_id, request_message_id, status,
          llm_provider_profile_id, llm_provider_model_id,
          default_image_profile_id, default_image_model_id,
          optimize_image_prompt, system_prompt_version, max_tool_calls, tool_call_count, current_step,
          cancel_requested, locked_by, locked_at, error_code, error_message,
          created_at, updated_at, finished_at
        ) VALUES (
          ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, 0, 0, 0,
          NULL, NULL, NULL, NULL, ?, ?, NULL
        )
      `)
      .run(
        id,
        input.projectId,
        input.conversationId,
        input.requestMessageId,
        input.llmProviderProfileId,
        input.llmProviderModelId,
        input.defaultImageProfileId ?? null,
        input.defaultImageModelId ?? null,
        input.optimizeImagePrompt === false ? 0 : 1,
        requireText(input.systemPromptVersion, "System prompt version"),
        maxToolCalls,
        now,
        now
      );
    const run = this.requireStored(id);
    this.#appendEventFromStored(run, "agent.run.created", { status: "queued" }, now);
    return toSnapshot(run);
  }

  findStoredById(agentRunId: string): StoredAgentRun | null {
    const row = this.#database.connection
      .prepare(`${AGENT_RUN_SELECT} WHERE id = ?`)
      .get(agentRunId) as AgentRunRow | undefined;
    return row ? mapStoredAgentRun(row) : null;
  }

  requireStored(agentRunId: string): StoredAgentRun {
    const run = this.findStoredById(agentRunId);
    if (!run) throw new AgentRunNotFoundError(agentRunId);
    return run;
  }

  listByConversation(conversationId: string): AgentRunSnapshot[] {
    const rows = this.#database.connection
      .prepare(`${AGENT_RUN_SELECT} WHERE conversation_id = ? ORDER BY created_at, id`)
      .all(conversationId) as unknown as AgentRunRow[];
    return rows.map((row) => toSnapshot(mapStoredAgentRun(row)));
  }

  claimNext(workerId: string): StoredAgentRun | null {
    const normalizedWorkerId = requireText(workerId, "Worker ID");
    return this.#database.transaction(() => {
      const row = this.#database.connection
        .prepare(`
          ${AGENT_RUN_SELECT}
          WHERE status IN ('queued', 'resuming') AND cancel_requested = 0
          ORDER BY created_at, id
          LIMIT 1
        `)
        .get() as AgentRunRow | undefined;
      if (!row) return null;
      const nextStatus: AgentRunStatus = row.status === "queued" ? "thinking" : "resuming";
      const now = new Date().toISOString();
      const result = this.#database.connection
        .prepare(`
          UPDATE agent_runs
          SET status = ?, locked_by = ?, locked_at = ?, updated_at = ?
          WHERE id = ? AND status = ? AND cancel_requested = 0
        `)
        .run(nextStatus, normalizedWorkerId, now, now, row.id, row.status);
      if (result.changes !== 1) return null;
      return this.requireStored(row.id);
    });
  }

  heartbeatLock(agentRunId: string, workerId: string): boolean {
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE agent_runs SET locked_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('thinking', 'calling_tool', 'resuming') AND locked_by = ?
      `)
      .run(now, now, agentRunId, workerId);
    return result.changes === 1;
  }

  isCancellationRequested(agentRunId: string, workerId: string): boolean {
    const row = this.#database.connection
      .prepare(`
        SELECT cancel_requested FROM agent_runs
        WHERE id = ? AND status IN ('thinking', 'calling_tool', 'resuming') AND locked_by = ?
      `)
      .get(agentRunId, workerId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  markCallingTool(agentRunId: string, workerId: string, toolCallCount: number): AgentRunSnapshot {
    if (!Number.isInteger(toolCallCount) || toolCallCount < 1) {
      throw new Error("Agent tool call count must be a positive integer.");
    }
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE agent_runs
        SET status = 'calling_tool', tool_call_count = ?, updated_at = ?
        WHERE id = ? AND status IN ('thinking', 'calling_tool', 'resuming') AND locked_by = ?
      `)
      .run(toolCallCount, now, agentRunId, workerId);
    if (result.changes !== 1) {
      throw new AgentRunTransitionError(
        `Agent run ${agentRunId} is not claimed by worker ${workerId}.`
      );
    }
    return toSnapshot(this.requireStored(agentRunId));
  }

  queueResume(agentRunId: string, expectedStatus: "waiting_tool" | "awaiting_user"): AgentRunSnapshot {
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE agent_runs
        SET status = 'resuming', updated_at = ?
        WHERE id = ? AND status = ? AND cancel_requested = 0
      `)
      .run(now, agentRunId, expectedStatus);
    if (result.changes !== 1) {
      throw new AgentRunTransitionError(
        `Agent run ${agentRunId} cannot resume from ${expectedStatus}.`
      );
    }
    return toSnapshot(this.requireStored(agentRunId));
  }

  releaseWaiting(
    agentRunId: string,
    workerId: string,
    status: "waiting_tool" | "awaiting_user",
    details: Record<string, unknown> = {}
  ): AgentRunSnapshot {
    return this.#transitionClaimed(agentRunId, workerId, status, null, null, details);
  }

  complete(
    agentRunId: string,
    workerId: string,
    details: Record<string, unknown> = {}
  ): AgentRunSnapshot {
    return this.#transitionClaimed(agentRunId, workerId, "completed", null, null, details);
  }

  fail(
    agentRunId: string,
    workerId: string,
    errorCode: string,
    errorMessage: string
  ): AgentRunSnapshot {
    return this.#transitionClaimed(
      agentRunId,
      workerId,
      "failed",
      requireText(errorCode, "Agent error code"),
      requireText(errorMessage, "Agent error message"),
      { errorCode, errorMessage }
    );
  }

  cancelClaimed(agentRunId: string, workerId: string): AgentRunSnapshot {
    return this.#transitionClaimed(agentRunId, workerId, "cancelled", null, null, {});
  }

  requestCancel(agentRunId: string): AgentRunSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(agentRunId);
      if (isTerminal(existing.status)) return toSnapshot(existing);
      const now = new Date().toISOString();
      if (
        existing.status === "queued" ||
        existing.status === "waiting_tool" ||
        existing.status === "awaiting_user"
      ) {
        this.#database.connection
          .prepare(`
            UPDATE agent_runs
            SET status = 'cancelled', cancel_requested = 1, locked_by = NULL,
                locked_at = NULL, finished_at = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(now, now, agentRunId);
        this.#appendEventFromStored(existing, "agent.cancelled", { status: "cancelled" }, now);
      } else {
        this.#database.connection
          .prepare("UPDATE agent_runs SET cancel_requested = 1, updated_at = ? WHERE id = ?")
          .run(now, agentRunId);
        this.#appendEventFromStored(existing, "agent.updated", { cancelRequested: true }, now);
      }
      return toSnapshot(this.requireStored(agentRunId));
    });
  }

  interruptOwned(workerId: string): AgentRunSnapshot[] {
    const rows = this.#database.connection
      .prepare(`
        ${AGENT_RUN_SELECT}
        WHERE status IN ('thinking', 'calling_tool', 'resuming') AND locked_by = ?
        ORDER BY created_at, id
      `)
      .all(workerId) as unknown as AgentRunRow[];
    return this.#interruptRows(rows, "locked_by = ?", workerId);
  }

  recoverStale(cutoff: string): AgentRunSnapshot[] {
    const rows = this.#database.connection
      .prepare(`
        ${AGENT_RUN_SELECT}
        WHERE status IN ('thinking', 'calling_tool', 'resuming') AND locked_at < ?
        ORDER BY created_at, id
      `)
      .all(cutoff) as unknown as AgentRunRow[];
    return this.#interruptRows(rows, "locked_at < ?", cutoff);
  }

  #transitionClaimed(
    agentRunId: string,
    workerId: string,
    status: "waiting_tool" | "awaiting_user" | "completed" | "failed" | "cancelled",
    errorCode: string | null,
    errorMessage: string | null,
    details: Record<string, unknown>
  ): AgentRunSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(agentRunId);
      if (!isClaimedStatus(existing.status) || existing.lockedBy !== workerId) {
        throw new AgentRunTransitionError(
          `Agent run ${agentRunId} is not claimed by worker ${workerId}.`
        );
      }
      const now = new Date().toISOString();
      const terminal = status === "completed" || status === "failed" || status === "cancelled";
      this.#database.connection
        .prepare(`
          UPDATE agent_runs
          SET status = ?, locked_by = NULL, locked_at = NULL,
              error_code = ?, error_message = ?, finished_at = ?, updated_at = ?
          WHERE id = ? AND locked_by = ?
        `)
        .run(status, errorCode, errorMessage, terminal ? now : null, now, agentRunId, workerId);
      const eventType =
        status === "waiting_tool"
          ? "agent.waiting_tool"
          : status === "awaiting_user"
            ? "agent.awaiting_user"
            : status === "completed"
              ? "agent.completed"
              : status === "cancelled"
                ? "agent.cancelled"
                : "agent.failed";
      this.#appendEventFromStored(existing, eventType, { status, ...structuredClone(details) }, now);
      return toSnapshot(this.requireStored(agentRunId));
    });
  }

  #interruptRows(
    rows: readonly AgentRunRow[],
    lockCondition: "locked_by = ?" | "locked_at < ?",
    lockValue: string
  ): AgentRunSnapshot[] {
    if (rows.length === 0) return [];
    return this.#database.transaction(() => {
      const snapshots: AgentRunSnapshot[] = [];
      for (const row of rows) {
        const now = new Date().toISOString();
        const result = this.#database.connection
          .prepare(`
            UPDATE agent_runs
            SET status = 'interrupted', locked_by = NULL, locked_at = NULL,
                error_code = 'WORKER_INTERRUPTED',
                error_message = 'Worker stopped before the Agent run completed.',
                finished_at = ?, updated_at = ?
            WHERE id = ? AND status IN ('thinking', 'calling_tool', 'resuming')
              AND ${lockCondition}
          `)
          .run(now, now, row.id, lockValue);
        if (result.changes !== 1) continue;
        this.#appendEvent(row, "agent.failed", { status: "interrupted" }, now);
        snapshots.push(toSnapshot(this.requireStored(row.id)));
      }
      return snapshots;
    });
  }

  #appendEvent(
    row: Pick<AgentRunRow, "project_id" | "conversation_id" | "id">,
    type: string,
    payload: Record<string, unknown>,
    createdAt: string
  ): void {
    this.#events.append({
      projectId: row.project_id,
      conversationId: row.conversation_id,
      agentRunId: row.id,
      jobId: null,
      type,
      payload,
      createdAt
    });
  }

  #appendEventFromStored(
    run: Pick<StoredAgentRun, "projectId" | "conversationId" | "id">,
    type: string,
    payload: Record<string, unknown>,
    createdAt: string
  ): void {
    this.#events.append({
      projectId: run.projectId,
      conversationId: run.conversationId,
      agentRunId: run.id,
      jobId: null,
      type,
      payload,
      createdAt
    });
  }
}

const AGENT_RUN_SELECT = `
  SELECT id, project_id, conversation_id, request_message_id, status,
         llm_provider_profile_id, llm_provider_model_id, default_image_profile_id,
         default_image_model_id, optimize_image_prompt, system_prompt_version, max_tool_calls,
         tool_call_count, current_step, cancel_requested, locked_by, locked_at,
         error_code, error_message, created_at, updated_at, finished_at
  FROM agent_runs
`;

function mapStoredAgentRun(row: AgentRunRow): StoredAgentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    requestMessageId: row.request_message_id,
    status: row.status,
    toolCallCount: row.tool_call_count,
    currentStep: row.current_step,
    cancelRequested: row.cancel_requested === 1,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    llmProviderProfileId: row.llm_provider_profile_id,
    llmProviderModelId: row.llm_provider_model_id,
    defaultImageProfileId: row.default_image_profile_id,
    defaultImageModelId: row.default_image_model_id,
    optimizeImagePrompt: row.optimize_image_prompt === 1,
    systemPromptVersion: row.system_prompt_version,
    maxToolCalls: row.max_tool_calls,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at
  };
}

function toSnapshot(run: StoredAgentRun): AgentRunSnapshot {
  const {
    llmProviderProfileId: _llmProviderProfileId,
    llmProviderModelId: _llmProviderModelId,
    defaultImageProfileId: _defaultImageProfileId,
    defaultImageModelId: _defaultImageModelId,
    optimizeImagePrompt: _optimizeImagePrompt,
    systemPromptVersion: _systemPromptVersion,
    maxToolCalls: _maxToolCalls,
    lockedBy: _lockedBy,
    lockedAt: _lockedAt,
    ...snapshot
  } = run;
  return structuredClone(snapshot);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function isClaimedStatus(status: AgentRunStatus): boolean {
  return status === "thinking" || status === "calling_tool" || status === "resuming";
}

function isTerminal(status: AgentRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}
