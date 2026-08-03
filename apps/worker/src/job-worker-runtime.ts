import { randomUUID } from "node:crypto";
import type { StoredJob } from "@lyra/storage";
import type {
  AgentRunRepository,
  JobRepository,
  WorkerInstanceRepository
} from "@lyra/storage";
import type { JobKind, WorkerKind } from "@lyra/contracts";
import { ProviderConnectionError } from "@lyra/providers";

export interface JobExecutionResult {
  outputAssetIds: string[];
  result: Record<string, unknown>;
}

export interface JobExecutor {
  execute(
    job: StoredJob,
    signal: AbortSignal,
    context: { workerId: string }
  ): Promise<JobExecutionResult>;
}

export interface JobWorkerRuntimeOptions {
  jobs: JobRepository;
  workers: WorkerInstanceRepository;
  executor: JobExecutor;
  agentRuns?: AgentRunRepository;
  workerId?: string;
  version: string;
  pid?: number | null;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  cancellationPollIntervalMs?: number;
  staleLockTimeoutMs?: number;
  executionTimeoutMs?: number;
  kinds?: readonly JobKind[];
  workerKind?: WorkerKind;
}

class WorkerStoppingError extends Error {
  constructor() {
    super("Worker is stopping.");
    this.name = "WorkerStoppingError";
  }
}

class JobCancellationError extends Error {
  constructor() {
    super("Job cancellation was requested.");
    this.name = "JobCancellationError";
  }
}

class JobTimeoutError extends Error {
  constructor(kind: WorkerKind) {
    super(`${kind} job exceeded its execution timeout.`);
    this.name = "JobTimeoutError";
  }
}

export class JobWorkerRuntime {
  readonly id: string;
  readonly #jobs: JobRepository;
  readonly #workers: WorkerInstanceRepository;
  readonly #agentRuns: AgentRunRepository | null;
  readonly #executor: JobExecutor;
  readonly #version: string;
  readonly #pid: number | null;
  readonly #pollIntervalMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #cancellationPollIntervalMs: number;
  readonly #staleLockTimeoutMs: number;
  readonly #executionTimeoutMs: number;
  readonly #kinds: readonly JobKind[];
  readonly #workerKind: WorkerKind;
  #running = false;
  #stopping = false;
  #loopPromise: Promise<void> | null = null;
  #activeController: AbortController | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: JobWorkerRuntimeOptions) {
    this.id = options.workerId?.trim() || randomUUID();
    this.#jobs = options.jobs;
    this.#workers = options.workers;
    this.#agentRuns = options.agentRuns ?? null;
    this.#executor = options.executor;
    this.#version = requireText(options.version, "Worker version");
    this.#pid = options.pid ?? null;
    this.#pollIntervalMs = validateInterval(options.pollIntervalMs ?? 100, "pollIntervalMs");
    this.#heartbeatIntervalMs = validateInterval(
      options.heartbeatIntervalMs ?? 1_000,
      "heartbeatIntervalMs"
    );
    this.#cancellationPollIntervalMs = validateInterval(
      options.cancellationPollIntervalMs ?? 100,
      "cancellationPollIntervalMs"
    );
    this.#staleLockTimeoutMs = validateInterval(
      options.staleLockTimeoutMs ?? 30_000,
      "staleLockTimeoutMs"
    );
    this.#executionTimeoutMs = validateInterval(
      options.executionTimeoutMs ?? 12 * 60_000,
      "executionTimeoutMs"
    );
    this.#kinds = options.kinds?.length ? [...options.kinds] : ["image.generate"];
    this.#workerKind = options.workerKind ?? "image";
  }

  get isRunning(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) throw new Error(`Worker ${this.id} is already running.`);
    this.#running = true;
    this.#stopping = false;
    this.#workers.register({
      id: this.id,
      kind: this.#workerKind,
      version: this.#version,
      pid: this.#pid
    });
    this.#heartbeatTimer = setInterval(() => {
      try {
        this.#workers.heartbeat(this.id);
      } catch (error) {
        this.#activeController?.abort(error);
      }
    }, this.#heartbeatIntervalMs);
    this.#heartbeatTimer.unref();
    const cutoff = new Date(Date.now() - this.#staleLockTimeoutMs).toISOString();
    this.#jobs.recoverStale(cutoff);
    this.#agentRuns?.recoverStale(cutoff);
    this.#loopPromise = this.#loop();
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#stopping = true;
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    this.#activeController?.abort(new WorkerStoppingError());
    await this.#loopPromise;
    this.#jobs.interruptOwned(this.id);
    this.#agentRuns?.interruptOwned(this.id);
    this.#workers.stop(this.id);
    this.#loopPromise = null;
    this.#running = false;
    this.#stopping = false;
  }

  async processNext(): Promise<boolean> {
    if (!this.#running) throw new Error(`Worker ${this.id} is not running.`);
    const job = this.#jobs.claimNext(this.id, this.#kinds);
    if (!job) return false;
    const controller = new AbortController();
    this.#activeController = controller;
    const heartbeat = setInterval(() => {
      try {
        this.#jobs.heartbeatLock(job.id, this.id);
      } catch (error) {
        controller.abort(error);
      }
    }, this.#heartbeatIntervalMs);
    heartbeat.unref();
    const cancellationPoll = setInterval(() => {
      try {
        if (this.#jobs.isCancellationRequested(job.id, this.id)) {
          controller.abort(new JobCancellationError());
        }
      } catch (error) {
        controller.abort(error);
      }
    }, this.#cancellationPollIntervalMs);
    cancellationPoll.unref();
    const executionTimeout = setTimeout(() => {
      controller.abort(new JobTimeoutError(this.#workerKind));
    }, this.#executionTimeoutMs);
    executionTimeout.unref();
    try {
      const output = await this.#executor.execute(
        job,
        controller.signal,
        { workerId: this.id }
      );
      if (this.#jobs.isCancellationRequested(job.id, this.id)) {
        this.#jobs.cancelClaimed(job.id, this.id);
      } else {
        this.#jobs.complete(job.id, this.id, output.outputAssetIds, output.result);
      }
    } catch (error) {
      if (this.#stopping || error instanceof WorkerStoppingError) {
        return true;
      }
      if (
        error instanceof JobCancellationError ||
        this.#jobs.isCancellationRequested(job.id, this.id)
      ) {
        this.#jobs.cancelClaimed(job.id, this.id);
      } else {
        const errorCode = error instanceof JobTimeoutError
          ? "JOB_TIMEOUT"
          : error instanceof ProviderConnectionError
            ? `PROVIDER_${error.code}`
            : "JOB_EXECUTION_FAILED";
        this.#jobs.fail(
          job.id,
          this.id,
          errorCode,
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancellationPoll);
      clearTimeout(executionTimeout);
      this.#activeController = null;
    }
    return true;
  }

  async #loop(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.processNext();
      if (!processed) await delay(this.#pollIntervalMs);
    }
  }
}

function validateInterval(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 10 || value > 3_600_000) {
    throw new Error(`${label} must be an integer between 10 and 3600000.`);
  }
  return value;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
