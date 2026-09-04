import { randomUUID } from "node:crypto";
import type {
  GenerationRequest,
  GenerationTaskStatus,
  JobRequest,
  JobListQuery,
  JobKind,
  JobSnapshot,
  ModelGenerationRequest
} from "@lyra/contracts";
import {
  isMultiViewToModelGenerationRequest,
  isModelGenerationRequest,
  isTextToModelGenerationRequest
} from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";
import { RuntimeEventRepository } from "./runtime-event-repository.js";

interface JobRow {
  id: string;
  project_id: string;
  conversation_id: string | null;
  agent_run_id: string | null;
  agent_step_id: string | null;
  request_message_id: string | null;
  retry_of_job_id: string | null;
  source: "agent" | "manual";
  kind: JobKind;
  status: GenerationTaskStatus;
  title: string;
  stage: string;
  provider_profile_id: string;
  provider_model_id: string;
  provider_name_snapshot: string;
  remote_model_id_snapshot: string;
  prompt: string;
  request_json: string;
  result_json: string | null;
  external_task_id: string | null;
  progress: number;
  provider_state_json: string;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: number;
  attempt: number;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  dismissed_at: string | null;
}

interface JobInputRow {
  job_id: string;
  asset_id: string;
  position: number;
  label: string;
}

interface JobOutputRow {
  job_id: string;
  asset_id: string;
  position: number;
}

export interface CreateJobInput {
  request: JobRequest;
  title: string;
  kind?: JobKind;
  conversationId?: string | null;
  agentRunId?: string | null;
  agentStepId?: string | null;
  requestMessageId?: string | null;
}

export interface RetryProviderSelection {
  providerProfileId: string;
  providerModelId: string;
}

export interface StoredJob extends JobSnapshot {
  request: JobRequest;
  providerState: Record<string, unknown>;
  lockedBy: string | null;
  lockedAt: string | null;
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

export class JobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobTransitionError";
  }
}

export class JobRepository {
  readonly #database: LyraDatabase;
  readonly #events: RuntimeEventRepository;

  constructor(database: LyraDatabase, events = new RuntimeEventRepository(database)) {
    this.#database = database;
    this.#events = events;
  }

  create(input: CreateJobInput): JobSnapshot {
    return this.#database.transaction(() => toSnapshot(this.#insert(input, 1, null)));
  }

  findById(jobId: string): JobSnapshot | null {
    const job = this.findStoredById(jobId);
    return job ? toSnapshot(job) : null;
  }

  findStoredById(jobId: string): StoredJob | null {
    const row = this.#database.connection
      .prepare(`${JOB_SELECT} WHERE id = ?`)
      .get(jobId) as JobRow | undefined;
    return row ? this.#mapStored(row) : null;
  }

  requireStored(jobId: string): StoredJob {
    const job = this.findStoredById(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    return job;
  }

  list(query: JobListQuery): JobSnapshot[] {
    const projectId = requireText(query.projectId, "Project ID");
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Job query limit must be an integer between 1 and 200.");
    }
    const where = ["project_id = ?", "dismissed_at IS NULL"];
    const parameters: Array<string | number> = [projectId];
    for (const [column, value] of [
      ["conversation_id", query.conversationId],
      ["agent_run_id", query.agentRunId],
      ["source", query.source],
      ["status", query.status],
      ["kind", query.kind]
    ] as const) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        parameters.push(value);
      }
    }
    parameters.push(limit);
    const rows = this.#database.connection
      .prepare(`${JOB_SELECT} WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...parameters) as unknown as JobRow[];
    return this.#mapStoredRows(rows).map(toSnapshot);
  }

  claimNext(workerId: string, kinds: readonly JobKind[] = ["image.generate"]): StoredJob | null {
    const normalizedWorkerId = requireText(workerId, "Worker ID");
    if (kinds.length === 0) return null;
    for (const kind of kinds) validateJobKind(kind);
    return this.#database.transaction(() => {
      const placeholders = kinds.map(() => "?").join(", ");
      const row = this.#database.connection
        .prepare(`
          ${JOB_SELECT}
          WHERE status = 'queued'
            AND cancel_requested = 0
            AND dismissed_at IS NULL
            AND kind IN (${placeholders})
          ORDER BY created_at, id
          LIMIT 1
        `)
        .get(...kinds) as JobRow | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const result = this.#database.connection
        .prepare(`
          UPDATE jobs
          SET status = 'running', stage = 'running', locked_by = ?, locked_at = ?,
              started_at = COALESCE(started_at, ?), updated_at = ?
          WHERE id = ? AND status = 'queued' AND cancel_requested = 0
        `)
        .run(normalizedWorkerId, now, now, now, row.id);
      if (result.changes !== 1) return null;
      this.#appendJobEvent(row, "job.updated", { status: "running", stage: "running" }, now);
      return this.requireStored(row.id);
    });
  }

  heartbeatLock(jobId: string, workerId: string): boolean {
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE jobs SET locked_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running' AND locked_by = ?
      `)
      .run(now, now, jobId, workerId);
    return result.changes === 1;
  }

  updateProviderCheckpoint(
    jobId: string,
    workerId: string,
    input: {
      externalTaskId?: string;
      progress?: number;
      stage?: string;
      providerState?: Record<string, unknown>;
    }
  ): JobSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(jobId);
      if (existing.status !== "running" || existing.lockedBy !== workerId) {
        throw new JobTransitionError(`Job ${jobId} is not claimed by worker ${workerId}.`);
      }
      const externalTaskId = input.externalTaskId === undefined
        ? existing.externalTaskId
        : requireText(input.externalTaskId, "External task ID");
      if (
        existing.externalTaskId !== null &&
        externalTaskId !== existing.externalTaskId
      ) {
        throw new JobTransitionError(`Job ${jobId} already has a different external task ID.`);
      }
      const requestedProgress = input.progress ?? existing.progress;
      if (
        !Number.isInteger(requestedProgress) ||
        requestedProgress < 0 ||
        requestedProgress > 100
      ) {
        throw new Error("Job progress must be an integer between 0 and 100.");
      }
      const progress = Math.max(existing.progress, requestedProgress);
      const stage = input.stage === undefined
        ? existing.stage
        : requireText(input.stage, "Job stage");
      const providerState = input.providerState === undefined
        ? existing.providerState
        : structuredClone(input.providerState);
      if (!isRecord(providerState)) throw new Error("Provider state must be an object.");
      const now = new Date().toISOString();
      this.#database.connection
        .prepare(`
          UPDATE jobs
          SET external_task_id = ?, progress = ?, stage = ?, provider_state_json = ?,
              updated_at = ?
          WHERE id = ? AND status = 'running' AND locked_by = ?
        `)
        .run(
          externalTaskId,
          progress,
          stage,
          JSON.stringify(providerState),
          now,
          jobId,
          workerId
        );
      this.#appendJobEvent(
        existing,
        "job.updated",
        { status: "running", stage, progress },
        now
      );
      return toSnapshot(this.requireStored(jobId));
    });
  }

  isCancellationRequested(jobId: string, workerId: string): boolean {
    const row = this.#database.connection
      .prepare(`
        SELECT cancel_requested FROM jobs
        WHERE id = ? AND status = 'running' AND locked_by = ?
      `)
      .get(jobId, workerId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  complete(
    jobId: string,
    workerId: string,
    outputAssetIds: readonly string[],
    result: Record<string, unknown> = {}
  ): JobSnapshot {
    return this.#finishClaimed({
      jobId,
      workerId,
      status: "succeeded",
      stage: "completed",
      eventType: "job.completed",
      outputAssetIds,
      result,
      errorCode: null,
      errorMessage: null
    });
  }

  fail(jobId: string, workerId: string, errorCode: string, errorMessage: string): JobSnapshot {
    return this.#finishClaimed({
      jobId,
      workerId,
      status: "failed",
      stage: "failed",
      eventType: "job.failed",
      outputAssetIds: [],
      result: null,
      errorCode: requireText(errorCode, "Job error code"),
      errorMessage: requireText(errorMessage, "Job error message")
    });
  }

  cancelClaimed(jobId: string, workerId: string): JobSnapshot {
    return this.#finishClaimed({
      jobId,
      workerId,
      status: "cancelled",
      stage: "cancelled",
      eventType: "job.cancelled",
      outputAssetIds: [],
      result: null,
      errorCode: null,
      errorMessage: null
    });
  }

  requestCancel(jobId: string): JobSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(jobId);
      if (isTerminal(existing.status)) return toSnapshot(existing);
      const now = new Date().toISOString();
      if (existing.status === "queued") {
        this.#database.connection
          .prepare(`
            UPDATE jobs
            SET status = 'cancelled', stage = 'cancelled', cancel_requested = 1,
                finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'queued'
          `)
          .run(now, now, jobId);
        this.#appendJobEvent(existing, "job.cancelled", { status: "cancelled" }, now);
      } else {
        this.#database.connection
          .prepare(`UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?`)
          .run(now, jobId);
        this.#appendJobEvent(existing, "job.updated", { cancelRequested: true }, now);
      }
      return toSnapshot(this.requireStored(jobId));
    });
  }

  retry(jobId: string, providerSelection?: RetryProviderSelection): JobSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(jobId);
      if (!(["failed", "cancelled", "interrupted"] as GenerationTaskStatus[]).includes(existing.status)) {
        throw new JobTransitionError(`Job ${jobId} cannot be retried from ${existing.status}.`);
      }
      const request = structuredClone(existing.request);
      if (providerSelection && existing.kind === "image.generate") {
        request.providerProfileId = requireText(
          providerSelection.providerProfileId,
          "Provider profile ID"
        );
        request.providerModelId = requireText(
          providerSelection.providerModelId,
          "Provider model ID"
        );
      }
      const created = this.#insert(
        {
          request,
          title: existing.title,
          kind: existing.kind,
          conversationId: existing.conversationId,
          agentRunId: existing.agentRunId,
          agentStepId: existing.agentStepId,
          requestMessageId: existing.requestMessageId
        },
        existing.attempt + 1,
        existing.id
      );
      if (
        existing.kind === "model.generate" &&
        existing.externalTaskId &&
        existing.providerState.status === "succeeded"
      ) {
        const now = new Date().toISOString();
        this.#database.connection
          .prepare(`
            UPDATE jobs
            SET external_task_id = ?, progress = ?, stage = 'resuming',
                provider_state_json = ?, updated_at = ?
            WHERE id = ? AND status = 'queued'
          `)
          .run(
            existing.externalTaskId,
            Math.min(existing.progress, 95),
            JSON.stringify(existing.providerState),
            now,
            created.id
          );
      }
      this.#dismissStored(existing, new Date().toISOString());
      return toSnapshot(this.requireStored(created.id));
    });
  }

  dismiss(jobId: string): JobSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(jobId);
      if (!isDismissible(existing.status)) {
        throw new JobTransitionError(`Job ${jobId} cannot be dismissed from ${existing.status}.`);
      }
      if (!existing.dismissedAt) this.#dismissStored(existing, new Date().toISOString());
      return toSnapshot(this.requireStored(jobId));
    });
  }

  dismissFailed(projectId: string): number {
    const normalizedProjectId = requireText(projectId, "Project ID");
    return this.#database.transaction(() => {
      const rows = this.#database.connection
        .prepare(`
          ${JOB_SELECT}
          WHERE project_id = ?
            AND dismissed_at IS NULL
            AND status IN ('failed', 'cancelled', 'interrupted')
          ORDER BY created_at, id
        `)
        .all(normalizedProjectId) as unknown as JobRow[];
      const now = new Date().toISOString();
      for (const row of rows) this.#dismissStored(this.#mapStored(row), now);
      return rows.length;
    });
  }

  interruptOwned(workerId: string, message = "Worker stopped before the job completed."): JobSnapshot[] {
    const rows = this.#database.connection
      .prepare(`${JOB_SELECT} WHERE status = 'running' AND locked_by = ? ORDER BY created_at, id`)
      .all(workerId) as unknown as JobRow[];
    return this.#interruptRows(rows, message, "locked_by = ?", workerId);
  }

  recoverStale(cutoff: string): JobSnapshot[] {
    const rows = this.#database.connection
      .prepare(`${JOB_SELECT} WHERE status = 'running' AND locked_at < ? ORDER BY created_at, id`)
      .all(cutoff) as unknown as JobRow[];
    return this.#interruptRows(
      rows,
      "Worker heartbeat expired before the job completed.",
      "locked_at < ?",
      cutoff
    );
  }

  #insert(input: CreateJobInput, attempt: number, retryOfJobId: string | null): StoredJob {
    const request = structuredClone(input.request);
    const title = requireText(input.title, "Job title");
    const kind = input.kind ?? (isModelGenerationRequest(request) ? "model.generate" : "image.generate");
    validateJobKind(kind);
    validateRequest(request, kind);
    const providerSnapshot = this.#resolveProviderSnapshot(
      request.providerProfileId,
      request.providerModelId
    );
    const now = new Date().toISOString();
    const id = randomUUID();
    this.#database.connection
      .prepare(`
        INSERT INTO jobs (
          id, project_id, conversation_id, agent_run_id, agent_step_id,
          request_message_id, retry_of_job_id, source, kind, status, title, stage,
          provider_profile_id, provider_model_id,
          provider_name_snapshot, remote_model_id_snapshot,
          prompt, request_json, result_json,
          external_task_id, progress, provider_state_json,
          error_code, error_message, cancel_requested, attempt, locked_by, locked_at,
          created_at, started_at, finished_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'queued', ?, ?, ?, ?, ?, ?, NULL,
          NULL, 0, '{}', NULL, NULL, 0, ?, NULL, NULL, ?, NULL, NULL, ?
        )
      `)
      .run(
        id,
        request.projectId,
        input.conversationId ?? null,
        input.agentRunId ?? null,
        input.agentStepId ?? null,
        input.requestMessageId ?? null,
        retryOfJobId,
        request.source,
        kind,
        title,
        request.providerProfileId,
        request.providerModelId,
        providerSnapshot.providerName,
        providerSnapshot.remoteModelId,
        isModelGenerationRequest(request)
          ? isTextToModelGenerationRequest(request) ? request.prompt : ""
          : request.prompt,
        JSON.stringify(request),
        attempt,
        now,
        now
      );
    const insertInput = this.#database.connection.prepare(
      "INSERT INTO job_inputs (job_id, asset_id, position, label) VALUES (?, ?, ?, ?)"
    );
    const inputs = isModelGenerationRequest(request)
      ? isTextToModelGenerationRequest(request)
        ? request.textureImageAssetId
          ? [{ assetId: request.textureImageAssetId, position: 1, label: "纹理输入图" }]
          : []
        : isMultiViewToModelGenerationRequest(request)
          ? modelViewEntries(request.multiViewImageAssetIds).map(([view, assetId], index) => ({
              assetId,
              position: index + 1,
              label: MODEL_VIEW_LABELS[view]
            }))
          : [
            { assetId: request.inputImageAssetId, position: 1, label: "模型输入图" },
            ...(request.textureImageAssetId
              ? [{
                  assetId: request.textureImageAssetId,
                  position: 2,
                  label: "纹理输入图"
                }]
              : [])
          ]
      : request.attachments;
    for (const attachment of inputs) {
      insertInput.run(id, attachment.assetId, attachment.position, attachment.label);
    }
    const row = this.#requireRow(id);
    this.#appendJobEvent(row, "job.created", { status: "queued", attempt }, now);
    return this.#mapStored(row);
  }

  #finishClaimed(input: {
    jobId: string;
    workerId: string;
    status: "succeeded" | "failed" | "cancelled";
    stage: string;
    eventType: string;
    outputAssetIds: readonly string[];
    result: Record<string, unknown> | null;
    errorCode: string | null;
    errorMessage: string | null;
  }): JobSnapshot {
    return this.#database.transaction(() => {
      const existing = this.requireStored(input.jobId);
      if (existing.status !== "running" || existing.lockedBy !== input.workerId) {
        throw new JobTransitionError(
          `Job ${input.jobId} is not claimed by worker ${input.workerId}.`
        );
      }
      const now = new Date().toISOString();
      const insertOutput = this.#database.connection.prepare(
        "INSERT INTO job_outputs (job_id, asset_id, position) VALUES (?, ?, ?)"
      );
      for (const [index, assetId] of input.outputAssetIds.entries()) {
        insertOutput.run(input.jobId, requireText(assetId, "Output asset ID"), index + 1);
      }
      this.#database.connection
        .prepare(`
          UPDATE jobs
          SET status = ?, stage = ?, result_json = ?, error_code = ?, error_message = ?,
              progress = ?, locked_by = NULL, locked_at = NULL,
              finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'running' AND locked_by = ?
        `)
        .run(
          input.status,
          input.stage,
          input.result === null ? null : JSON.stringify(input.result),
          input.errorCode,
          input.errorMessage,
          input.status === "succeeded" ? 100 : existing.progress,
          now,
          now,
          input.jobId,
          input.workerId
        );
      for (const assetId of input.outputAssetIds) {
        this.#appendJobEvent(existing, "asset.created", { assetId }, now);
      }
      this.#appendJobEvent(
        existing,
        input.eventType,
        { status: input.status, outputAssetIds: [...input.outputAssetIds] },
        now
      );
      return toSnapshot(this.requireStored(input.jobId));
    });
  }

  #interruptRows(
    rows: readonly JobRow[],
    message: string,
    lockCondition: "locked_by = ?" | "locked_at < ?",
    lockValue: string
  ): JobSnapshot[] {
    if (rows.length === 0) return [];
    return this.#database.transaction(() => {
      const interrupted: JobSnapshot[] = [];
      for (const row of rows) {
        const now = new Date().toISOString();
        if (row.kind === "model.generate" && row.external_task_id) {
          const result = this.#database.connection
            .prepare(`
              UPDATE jobs
              SET status = 'queued', stage = 'resuming', error_code = NULL,
                  error_message = NULL, locked_by = NULL, locked_at = NULL,
                  finished_at = NULL, updated_at = ?
              WHERE id = ? AND status = 'running' AND ${lockCondition}
            `)
            .run(now, row.id, lockValue);
          if (result.changes !== 1) continue;
          this.#appendJobEvent(
            row,
            "job.updated",
            { status: "queued", stage: "resuming", progress: row.progress },
            now
          );
          interrupted.push(toSnapshot(this.requireStored(row.id)));
          continue;
        }
        const result = this.#database.connection
          .prepare(`
            UPDATE jobs
            SET status = 'interrupted', stage = 'interrupted', error_code = 'WORKER_INTERRUPTED',
                error_message = ?, locked_by = NULL, locked_at = NULL,
                finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'running' AND ${lockCondition}
          `)
          .run(message, now, now, row.id, lockValue);
        if (result.changes !== 1) continue;
        this.#appendJobEvent(row, "job.failed", { status: "interrupted" }, now);
        interrupted.push(toSnapshot(this.requireStored(row.id)));
      }
      return interrupted;
    });
  }

  #mapStored(
    row: JobRow,
    loadedInputs?: readonly JobInputRow[],
    loadedOutputs?: readonly JobOutputRow[]
  ): StoredJob {
    const rawRequest = parseRecord(row.request_json, `Job ${row.id} request`);
    const inputs = loadedInputs ?? this.#loadInputs(row.id);
    const outputs = loadedOutputs ?? this.#loadOutputs(row.id);
    const request = normalizeStoredRequest(row, rawRequest, inputs);
    const result = row.result_json ? parseRecord(row.result_json, `Job ${row.id} result`) : null;
    const providerState = parseRecord(
      row.provider_state_json,
      `Job ${row.id} provider state`
    );
    return {
      id: row.id,
      projectId: row.project_id,
      conversationId: row.conversation_id,
      agentRunId: row.agent_run_id,
      agentStepId: row.agent_step_id,
      requestMessageId: row.request_message_id,
      retryOfJobId: row.retry_of_job_id,
      source: row.source,
      kind: row.kind,
      status: row.status,
      title: row.title,
      stage: row.stage,
      providerProfileId: row.provider_profile_id,
      providerModelId: row.provider_model_id,
      providerName: row.provider_name_snapshot,
      remoteModelId: row.remote_model_id_snapshot,
      prompt: isModelGenerationRequest(request)
        ? isTextToModelGenerationRequest(request) ? row.prompt : null
        : row.prompt,
      count: isModelGenerationRequest(request) ? null : request.count,
      parameters: structuredClone(request.parameters),
      cancelRequested: row.cancel_requested === 1,
      attempt: row.attempt,
      inputs: inputs.map(({ job_id: _jobId, asset_id, position, label }) => ({
        assetId: asset_id,
        position,
        label
      })),
      outputs: outputs.map(({ job_id: _jobId, asset_id, position }) => ({
        assetId: asset_id,
        position
      })),
      result,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      progress: row.progress,
      externalTaskId: row.external_task_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      dismissedAt: row.dismissed_at,
      request,
      providerState,
      lockedBy: row.locked_by,
      lockedAt: row.locked_at
    };
  }

  #mapStoredRows(rows: readonly JobRow[]): StoredJob[] {
    if (rows.length === 0) return [];
    const jobIds = rows.map((row) => row.id);
    const inputsByJob = groupRowsByJob(this.#loadInputsForJobs(jobIds));
    const outputsByJob = groupRowsByJob(this.#loadOutputsForJobs(jobIds));
    return rows.map((row) => this.#mapStored(
      row,
      inputsByJob.get(row.id) ?? [],
      outputsByJob.get(row.id) ?? []
    ));
  }

  #loadInputs(jobId: string): JobInputRow[] {
    return this.#database.connection
      .prepare(`
        SELECT job_id, asset_id, position, label FROM job_inputs
        WHERE job_id = ? ORDER BY position
      `)
      .all(jobId) as unknown as JobInputRow[];
  }

  #loadOutputs(jobId: string): JobOutputRow[] {
    return this.#database.connection
      .prepare(`
        SELECT job_id, asset_id, position FROM job_outputs
        WHERE job_id = ? ORDER BY position
      `)
      .all(jobId) as unknown as JobOutputRow[];
  }

  #loadInputsForJobs(jobIds: readonly string[]): JobInputRow[] {
    const placeholders = jobIds.map(() => "?").join(", ");
    return this.#database.connection
      .prepare(`
        SELECT job_id, asset_id, position, label FROM job_inputs
        WHERE job_id IN (${placeholders}) ORDER BY job_id, position
      `)
      .all(...jobIds) as unknown as JobInputRow[];
  }

  #loadOutputsForJobs(jobIds: readonly string[]): JobOutputRow[] {
    const placeholders = jobIds.map(() => "?").join(", ");
    return this.#database.connection
      .prepare(`
        SELECT job_id, asset_id, position FROM job_outputs
        WHERE job_id IN (${placeholders}) ORDER BY job_id, position
      `)
      .all(...jobIds) as unknown as JobOutputRow[];
  }

  #requireRow(jobId: string): JobRow {
    const row = this.#database.connection
      .prepare(`${JOB_SELECT} WHERE id = ?`)
      .get(jobId) as JobRow | undefined;
    if (!row) throw new JobNotFoundError(jobId);
    return row;
  }

  #appendJobEvent(
    job:
      | Pick<JobRow, "project_id" | "conversation_id" | "agent_run_id" | "id">
      | Pick<StoredJob, "projectId" | "conversationId" | "agentRunId" | "id">,
    type: string,
    payload: Record<string, unknown>,
    createdAt: string
  ): void {
    const projectId = "project_id" in job ? job.project_id : job.projectId;
    const conversationId = "conversation_id" in job ? job.conversation_id : job.conversationId;
    const agentRunId = "agent_run_id" in job ? job.agent_run_id : job.agentRunId;
    this.#events.append({
      projectId,
      conversationId,
      agentRunId,
      jobId: job.id,
      type,
      payload,
      createdAt
    });
  }

  #dismissStored(job: StoredJob, dismissedAt: string): void {
    const result = this.#database.connection
      .prepare(`
        UPDATE jobs
        SET dismissed_at = ?, updated_at = ?
        WHERE id = ? AND dismissed_at IS NULL
      `)
      .run(dismissedAt, dismissedAt, job.id);
    if (result.changes === 1) {
      this.#appendJobEvent(job, "job.dismissed", { dismissedAt }, dismissedAt);
    }
  }

  #resolveProviderSnapshot(
    providerProfileId: string,
    providerModelId: string
  ): { providerName: string; remoteModelId: string } {
    const row = this.#database.connection
      .prepare(`
        SELECT p.name AS provider_name, m.remote_model_id
        FROM provider_profiles p
        JOIN provider_models m ON m.provider_profile_id = p.id
        WHERE p.id = ? AND m.id = ?
      `)
      .get(providerProfileId, providerModelId) as
        | { provider_name: string; remote_model_id: string }
        | undefined;
    if (!row) {
      throw new Error("Provider model does not belong to the selected provider.");
    }
    return {
      providerName: row.provider_name,
      remoteModelId: row.remote_model_id
    };
  }
}

const JOB_SELECT = `
  SELECT id, project_id, conversation_id, agent_run_id, agent_step_id,
         request_message_id, retry_of_job_id, source, kind, status, title, stage,
         provider_profile_id, provider_model_id,
         provider_name_snapshot, remote_model_id_snapshot,
         prompt, request_json, result_json,
         external_task_id, progress, provider_state_json,
         error_code, error_message, cancel_requested, attempt, locked_by, locked_at,
         created_at, started_at, finished_at, updated_at, dismissed_at
  FROM jobs
`;

function toSnapshot(job: StoredJob): JobSnapshot {
  const {
    request: _request,
    providerState: _providerState,
    lockedBy: _lockedBy,
    lockedAt: _lockedAt,
    ...snapshot
  } = job;
  return structuredClone(snapshot);
}

function validateRequest(request: JobRequest, kind: JobKind): void {
  requireText(request.projectId, "Project ID");
  requireText(request.providerProfileId, "Provider profile ID");
  requireText(request.providerModelId, "Provider model ID");
  if (request.source !== "agent" && request.source !== "manual") {
    throw new Error("Generation source is invalid.");
  }
  if (kind === "model.generate") {
    if (!isModelGenerationRequest(request)) {
      throw new Error("Model jobs require a model generation request.");
    }
    if (isTextToModelGenerationRequest(request)) {
      requireText(request.prompt, "Text-to-model prompt");
    } else if (isMultiViewToModelGenerationRequest(request)) {
      const views = modelViewEntries(request.multiViewImageAssetIds);
      if (views.length < 2) throw new Error("Multi-view model input requires at least two images.");
      for (const [, assetId] of views) requireText(assetId, "Multi-view model input image asset ID");
    } else {
      requireText(request.inputImageAssetId, "Model input image asset ID");
    }
    if (request.textureImageAssetId !== undefined) {
      requireText(request.textureImageAssetId, "Texture input image asset ID");
    }
    if (
      request.outputFormats.length < 1 ||
      new Set(request.outputFormats).size !== request.outputFormats.length ||
      request.outputFormats.some((format) =>
        !["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(format)
      )
    ) {
      throw new Error("Model output formats are invalid.");
    }
    if (!isRecord(request.parameters)) throw new Error("Model parameters must be an object.");
    return;
  }
  if (isModelGenerationRequest(request)) {
    throw new Error("Image jobs require an image generation request.");
  }
  requireText(request.prompt, "Generation prompt");
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 8) {
    throw new Error("Generation count must be an integer between 1 and 8.");
  }
  request.attachments.forEach((attachment, index) => {
    if (attachment.position !== index + 1) {
      throw new Error("Attachment positions must be continuous and start at 1.");
    }
    requireText(attachment.assetId, "Attachment asset ID");
    requireText(attachment.label, "Attachment label");
  });
  if (!isRecord(request.parameters)) throw new Error("Generation parameters must be an object.");
}

function normalizeStoredRequest(
  row: JobRow,
  raw: Record<string, unknown>,
  inputs: readonly JobInputRow[]
): JobRequest {
  if (row.kind === "image.generate") {
    return raw as unknown as GenerationRequest;
  }
  if (Array.isArray(raw.outputFormats)) {
    if (raw.inputMode === "text" && typeof raw.prompt === "string") {
      return raw as unknown as ModelGenerationRequest;
    }
    if (raw.inputMode === "multiview" && isRecord(raw.multiViewImageAssetIds)) {
      return raw as unknown as ModelGenerationRequest;
    }
    if (typeof raw.inputImageAssetId === "string") {
      return {
        ...raw,
        inputMode: "image"
      } as unknown as ModelGenerationRequest;
    }
  }
  const legacy = raw as unknown as GenerationRequest;
  const inputImageAssetId =
    inputs[0]?.asset_id ??
    (Array.isArray(legacy.attachments) ? legacy.attachments[0]?.assetId : undefined);
  return {
    projectId: row.project_id,
    inputMode: "image",
    inputImageAssetId: requireText(inputImageAssetId ?? "", "Model input image asset ID"),
    providerProfileId: row.provider_profile_id,
    providerModelId: row.provider_model_id,
    outputFormats: ["glb"],
    parameters: isRecord(legacy.parameters) ? structuredClone(legacy.parameters) : {},
    source: row.source
  };
}

function isDismissible(status: GenerationTaskStatus): boolean {
  return status === "failed" || status === "cancelled" || status === "interrupted";
}

function validateJobKind(kind: JobKind): void {
  if (kind !== "image.generate" && kind !== "model.generate") {
    throw new Error("Job kind is invalid.");
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function groupRowsByJob<T extends { job_id: string }>(
  rows: readonly T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.job_id);
    if (current) current.push(row);
    else grouped.set(row.job_id, [row]);
  }
  return grouped;
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error(`${label} must be an object.`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MODEL_VIEW_LABELS = {
  front: "正面图",
  left: "左面图",
  back: "背面图",
  right: "右面图",
  top: "顶面图",
  bottom: "底面图",
  leftFront: "左前 45° 图",
  rightFront: "右前 45° 图"
} as const;

function modelViewEntries(images: Partial<Record<keyof typeof MODEL_VIEW_LABELS, string>>): Array<[
  keyof typeof MODEL_VIEW_LABELS,
  string
]> {
  return (Object.keys(MODEL_VIEW_LABELS) as Array<keyof typeof MODEL_VIEW_LABELS>)
    .flatMap((view) => images[view] ? [[view, images[view]!]] : []);
}

function isTerminal(status: GenerationTaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
}
