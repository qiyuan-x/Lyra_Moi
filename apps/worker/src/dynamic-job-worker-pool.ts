import type { JobWorkerRuntime } from "./job-worker-runtime.js";

export interface DynamicJobWorkerPoolOptions {
  createWorker: (canClaim: () => boolean) => JobWorkerRuntime;
  readConcurrency: () => number;
  minimumConcurrency?: number;
  maximumConcurrency?: number;
  refreshIntervalMs?: number;
}

/** Keeps a worker pool aligned with a persisted concurrency setting. */
export class DynamicJobWorkerPool {
  readonly #createWorker: (canClaim: () => boolean) => JobWorkerRuntime;
  readonly #readConcurrency: () => number;
  readonly #minimumConcurrency: number;
  readonly #maximumConcurrency: number;
  readonly #refreshIntervalMs: number;
  readonly #workers: JobWorkerRuntime[] = [];
  #concurrency = 1;
  #refreshTimer: ReturnType<typeof setInterval> | null = null;
  #started = false;

  constructor(options: DynamicJobWorkerPoolOptions) {
    this.#createWorker = options.createWorker;
    this.#readConcurrency = options.readConcurrency;
    this.#minimumConcurrency = options.minimumConcurrency ?? 1;
    this.#maximumConcurrency = options.maximumConcurrency ?? 8;
    this.#refreshIntervalMs = options.refreshIntervalMs ?? 1_000;
    if (
      !Number.isInteger(this.#minimumConcurrency) ||
      !Number.isInteger(this.#maximumConcurrency) ||
      this.#minimumConcurrency < 1 ||
      this.#maximumConcurrency < this.#minimumConcurrency
    ) {
      throw new Error("Worker pool concurrency range is invalid.");
    }
    if (!Number.isInteger(this.#refreshIntervalMs) || this.#refreshIntervalMs < 100) {
      throw new Error("Worker pool refresh interval must be at least 100 ms.");
    }
    this.#resize(false);
  }

  get workers(): readonly JobWorkerRuntime[] {
    return this.#workers.slice(0, this.#concurrency);
  }

  start(): void {
    if (this.#started) throw new Error("Worker pool is already started.");
    this.#started = true;
    this.#resize(false);
    for (const worker of this.#workers) worker.start();
    this.#refreshTimer = setInterval(() => this.#resize(true), this.#refreshIntervalMs);
    this.#refreshTimer.unref();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    this.#refreshTimer = null;
    await Promise.all(this.#workers.map((worker) => worker.stop()));
  }

  /** Applies the current setting immediately. Primarily used by tests. */
  refresh(): void {
    this.#resize(this.#started);
  }

  #resize(startNewWorkers: boolean): void {
    const desired = this.#desiredConcurrency();
    this.#concurrency = desired;
    while (this.#workers.length < desired) {
      const index = this.#workers.length;
      const worker = this.#createWorker(() =>
        this.#started && index < this.#concurrency &&
        this.#workers.filter((item) => item.isBusy).length < this.#concurrency
      );
      this.#workers.push(worker);
      if (startNewWorkers) worker.start();
    }
    // Extra slots stay idle; lowering the limit never aborts in-flight jobs.
  }

  #desiredConcurrency(): number {
    const value = this.#readConcurrency();
    if (!Number.isInteger(value)) return this.#minimumConcurrency;
    return Math.max(
      this.#minimumConcurrency,
      Math.min(this.#maximumConcurrency, value)
    );
  }
}
