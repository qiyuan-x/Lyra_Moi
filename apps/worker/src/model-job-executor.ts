import type { AssetService } from "@lyra/core";
import { isModelGenerationRequest } from "@lyra/contracts";
import {
  ProviderConnectionError,
  type BinaryModelProvider,
  type ModelProviderResult
} from "@lyra/providers";
import type { JobRepository, StoredJob } from "@lyra/storage";
import type { JobExecutionResult, JobExecutor } from "./job-worker-runtime.js";

export interface ModelProviderResolver {
  resolve(
    providerProfileId: string,
    providerModelId: string
  ): BinaryModelProvider | Promise<BinaryModelProvider>;
}

export interface ModelJobExecutorOptions {
  providerResolver: ModelProviderResolver;
  assets: AssetService;
  jobs: JobRepository;
  pollIntervalMs?: number;
}

export class ModelJobExecutor implements JobExecutor {
  readonly #providerResolver: ModelProviderResolver;
  readonly #assets: AssetService;
  readonly #jobs: JobRepository;
  readonly #pollIntervalMs: number;

  constructor(options: ModelJobExecutorOptions) {
    this.#providerResolver = options.providerResolver;
    this.#assets = options.assets;
    this.#jobs = options.jobs;
    this.#pollIntervalMs = options.pollIntervalMs ?? 5_000;
    if (
      !Number.isInteger(this.#pollIntervalMs) ||
      this.#pollIntervalMs < 250 ||
      this.#pollIntervalMs > 60_000
    ) {
      throw new Error("Model polling interval must be between 250 and 60000 milliseconds.");
    }
  }

  async execute(
    job: StoredJob,
    signal: AbortSignal,
    context: { workerId: string }
  ): Promise<JobExecutionResult> {
    if (job.kind !== "model.generate") {
      throw new Error(`Model worker cannot execute job kind ${job.kind}.`);
    }
    if (!isModelGenerationRequest(job.request)) {
      throw new Error("Model job request is invalid.");
    }
    const request = job.request;
    const provider = await this.#providerResolver.resolve(
      request.providerProfileId,
      request.providerModelId
    );
    let externalTaskId = job.externalTaskId;
    if (!externalTaskId) {
      externalTaskId = await provider.submit(request, signal);
      this.#jobs.updateProviderCheckpoint(job.id, context.workerId, {
        externalTaskId,
        progress: 2,
        stage: "submitted"
      });
    }

    let result: ModelProviderResult;
    while (true) {
      signal.throwIfAborted();
      result = await provider.query(externalTaskId, signal);
      if (result.status === "failed") {
        throw new ProviderConnectionError(
          "BAD_REQUEST",
          result.errorMessage ?? "Model provider task failed."
        );
      }
      if (result.status === "succeeded") {
        const checkpoint: Parameters<JobRepository["updateProviderCheckpoint"]>[2] = {
          progress: 95,
          stage: "downloading",
          providerState: toProviderState(result)
        };
        if (result.nextExternalTaskId) {
          externalTaskId = result.nextExternalTaskId;
          checkpoint.externalTaskId = externalTaskId;
        }
        this.#jobs.updateProviderCheckpoint(job.id, context.workerId, checkpoint);
        break;
      }
      const checkpoint: Parameters<JobRepository["updateProviderCheckpoint"]>[2] = {
        progress: Math.min(90, result.progress),
        stage: result.status === "pending" ? "provider_queued" : "generating",
        providerState: toProviderState(result)
      };
      if (result.nextExternalTaskId) {
        externalTaskId = result.nextExternalTaskId;
        checkpoint.externalTaskId = externalTaskId;
      }
      this.#jobs.updateProviderCheckpoint(job.id, context.workerId, checkpoint);
      await abortableDelay(this.#pollIntervalMs, signal);
    }

    const generated = await provider.download(result, request, signal);
    signal.throwIfAborted();
    const assets = [];
    for (const file of generated) {
      assets.push(await this.#assets.storeGeneratedModel({
        projectId: job.projectId,
        data: file.data,
        name: file.name,
        format: file.format,
        extension: file.extension,
        mimeType: file.mimeType,
        tags: ["AI建模", file.format.toUpperCase()]
      }));
    }
    return {
      outputAssetIds: assets.map((asset) => asset.id),
      result: {
        outputCount: assets.length,
        outputFormats: generated.map((file) => file.format),
        externalTaskId,
        ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
        ...(result.consumedCredits === undefined
          ? {}
          : { consumedCredits: result.consumedCredits })
      }
    };
  }
}

function toProviderState(result: ModelProviderResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
    ...(result.consumedCredits === undefined
      ? {}
      : { consumedCredits: result.consumedCredits }),
    ...(result.providerState ?? {})
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Model job was aborted."));
      return;
    }
    const timer = setTimeout(done, milliseconds);
    timer.unref();
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Model job was aborted."));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}
