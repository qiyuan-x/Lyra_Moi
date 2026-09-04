import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetService, QueuedGenerationService } from "@lyra/core";
import { FakeBinaryImageProvider, ProviderConnectionError } from "@lyra/providers";
import {
  AssetRepository,
  ImmutableBlobStore,
  JobRepository,
  LyraDatabase,
  RuntimeEventRepository,
  SharpImageProcessor,
  ThumbnailStore,
  WorkerInstanceRepository
} from "@lyra/storage";
import { ImageJobExecutor, JobWorkerRuntime } from "@lyra/worker";
import { prepareM4Database } from "../fixtures/m4-database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("JobWorkerRuntime", () => {
  it("runs a queued image job and persists generated assets and events", async () => {
    const fixture = await createFixture("success", { delayMs: 20 });
    try {
      const submitted = fixture.generations.submit({
        projectId: fixture.seed.projectId,
        prompt: "generate two images",
        attachments: [],
        providerProfileId: fixture.seed.providerProfileId,
        providerModelId: fixture.seed.imageModelId,
        count: 2,
        parameters: { aspectRatio: "1:1" },
        source: "manual"
      });
      fixture.worker.start();
      expect(
        fixture.workers.isReady(
          "image",
          "test-v1",
          new Date(Date.now() - 1_000).toISOString()
        )
      ).toBe(true);
      const completed = await waitForJob(fixture.jobs, submitted.id, "succeeded");
      expect(completed.outputs).toHaveLength(2);
      expect(completed.result).toEqual({ outputCount: 2 });
      expect(completed.outputs.map((output) => fixture.assets.getAsset(output.assetId))).toEqual([
        expect.objectContaining({ source: "generated", name: "fake-output-1" }),
        expect.objectContaining({ source: "generated", name: "fake-output-2" })
      ]);
      expect(fixture.provider.requests).toHaveLength(1);
      expect(
        fixture.events.list({ projectId: fixture.seed.projectId }).map((event) => event.type)
      ).toEqual([
        "job.created",
        "job.updated",
        "asset.created",
        "asset.created",
        "job.completed"
      ]);
      await fixture.worker.stop();
      expect(fixture.workers.findById(fixture.worker.id)?.stoppedAt).not.toBeNull();
      expect(
        fixture.workers.isReady(
          "image",
          "test-v1",
          new Date(Date.now() - 1_000).toISOString()
        )
      ).toBe(false);
    } finally {
      await fixture.worker.stop();
      fixture.database.close();
    }
  });

  it("cancels running work and marks work interrupted on worker stop", async () => {
    const fixture = await createFixture("control", { delayMs: 500 });
    try {
      const cancelledJob = fixture.generations.submit({
        projectId: fixture.seed.projectId,
        prompt: "cancel me",
        attachments: [],
        providerProfileId: fixture.seed.providerProfileId,
        providerModelId: fixture.seed.imageModelId,
        count: 1,
        parameters: {},
        source: "manual"
      });
      fixture.worker.start();
      await waitForJob(fixture.jobs, cancelledJob.id, "running");
      fixture.generations.cancel(cancelledJob.id);
      await waitForJob(fixture.jobs, cancelledJob.id, "cancelled");

      const interruptedJob = fixture.generations.submit({
        projectId: fixture.seed.projectId,
        prompt: "stop worker",
        attachments: [],
        providerProfileId: fixture.seed.providerProfileId,
        providerModelId: fixture.seed.imageModelId,
        count: 1,
        parameters: {},
        source: "manual"
      });
      await waitForJob(fixture.jobs, interruptedJob.id, "running");
      await fixture.worker.stop();
      expect(fixture.jobs.findById(interruptedJob.id)).toMatchObject({
        status: "interrupted",
        errorCode: "WORKER_INTERRUPTED"
      });
    } finally {
      await fixture.worker.stop();
      fixture.database.close();
    }
  });

  it("records provider failures and execution timeouts", async () => {
    const failedFixture = await createFixture("failure", {
      delayMs: 10,
      failWith: "provider failed"
    });
    try {
      const failedJob = submitOne(failedFixture, "fail");
      failedFixture.worker.start();
      expect(await waitForJob(failedFixture.jobs, failedJob.id, "failed")).toMatchObject({
        errorCode: "JOB_EXECUTION_FAILED",
        errorMessage: "provider failed"
      });
    } finally {
      await failedFixture.worker.stop();
      failedFixture.database.close();
    }

    const timeoutFixture = await createFixture("timeout", { delayMs: 500 }, 30);
    try {
      const timeoutJob = submitOne(timeoutFixture, "timeout");
      timeoutFixture.worker.start();
      expect(await waitForJob(timeoutFixture.jobs, timeoutJob.id, "failed")).toMatchObject({
        errorCode: "JOB_TIMEOUT"
      });
    } finally {
      await timeoutFixture.worker.stop();
      timeoutFixture.database.close();
    }
  });

  it("does not impose a fixed execution timeout on image jobs", async () => {
    const fixture = await createFixture("no-timeout", { delayMs: 80 }, null);
    try {
      const submitted = submitOne(fixture, "wait for provider");
      fixture.worker.start();
      expect(await waitForJob(fixture.jobs, submitted.id, "succeeded")).toMatchObject({
        errorCode: null
      });
    } finally {
      await fixture.worker.stop();
      fixture.database.close();
    }
  });

  it("resolves the image provider from each job snapshot", async () => {
    const fixture = await createFixture("resolver", { delayMs: 1 });
    try {
      const submitted = fixture.generations.submit({
        projectId: fixture.seed.projectId,
        prompt: "dynamic provider",
        attachments: [],
        providerProfileId: fixture.seed.providerProfileId,
        providerModelId: fixture.seed.imageModelId,
        count: 1,
        parameters: {},
        source: "manual"
      });
      const resolved: string[][] = [];
      const executor = new ImageJobExecutor({
        assets: fixture.assets,
        providerResolver: {
          resolve(profileId, modelId) {
            resolved.push([profileId, modelId]);
            return fixture.provider;
          }
        }
      });
      const output = await executor.execute(
        fixture.jobs.requireStored(submitted.id),
        new AbortController().signal
      );
      expect(resolved).toEqual([[fixture.seed.providerProfileId, fixture.seed.imageModelId]]);
      expect(output.outputAssetIds).toHaveLength(1);
    } finally {
      fixture.database.close();
    }
  });

  it("persists stable provider error codes", async () => {
    const fixture = await createFixture("provider-error", { delayMs: 1 });
    const worker = new JobWorkerRuntime({
      jobs: fixture.jobs,
      workers: fixture.workers,
      executor: new ImageJobExecutor({
        assets: fixture.assets,
        provider: {
          async generate() {
            throw new ProviderConnectionError("RATE_LIMITED", "Provider returned HTTP 429.", 429);
          }
        }
      }),
      workerId: "worker-provider-error-specific",
      version: "test-v1",
      pollIntervalMs: 10,
      heartbeatIntervalMs: 20,
      cancellationPollIntervalMs: 10,
      staleLockTimeoutMs: 1_000,
      executionTimeoutMs: 3_000
    });
    try {
      const submitted = submitOne(fixture, "rate limit");
      worker.start();
      expect(await waitForJob(fixture.jobs, submitted.id, "failed")).toMatchObject({
        errorCode: "PROVIDER_RATE_LIMITED",
        errorMessage: "Provider returned HTTP 429."
      });
    } finally {
      await worker.stop();
      fixture.database.close();
    }
  });
});

async function createFixture(
  suffix: string,
  providerOptions: ConstructorParameters<typeof FakeBinaryImageProvider>[0],
  executionTimeoutMs: number | null = 3_000
) {
  const directory = await mkdtemp(join(tmpdir(), `lyra-worker-${suffix}-`));
  temporaryDirectories.push(directory);
  const database = new LyraDatabase(join(directory, "database", "lyra.sqlite3"));
  const seed = prepareM4Database(database);
  const events = new RuntimeEventRepository(database);
  const jobs = new JobRepository(database, events);
  const workers = new WorkerInstanceRepository(database);
  const assets = new AssetService({
    assets: new AssetRepository(database),
    blobs: new ImmutableBlobStore(join(directory, "blobs")),
    thumbnails: new ThumbnailStore(join(directory, "thumbnails")),
    images: new SharpImageProcessor()
  });
  const provider = new FakeBinaryImageProvider(providerOptions);
  const worker = new JobWorkerRuntime({
    jobs,
    workers,
    executor: new ImageJobExecutor({ provider, assets }),
    workerId: `worker-${suffix}`,
    version: "test-v1",
    pollIntervalMs: 10,
    heartbeatIntervalMs: 20,
    cancellationPollIntervalMs: 10,
    staleLockTimeoutMs: 1_000,
    executionTimeoutMs
  });
  return {
    directory,
    database,
    seed,
    events,
    jobs,
    workers,
    assets,
    provider,
    worker,
    generations: new QueuedGenerationService(jobs)
  };
}

function submitOne(fixture: Awaited<ReturnType<typeof createFixture>>, prompt: string) {
  return fixture.generations.submit({
    projectId: fixture.seed.projectId,
    prompt,
    attachments: [],
    providerProfileId: fixture.seed.providerProfileId,
    providerModelId: fixture.seed.imageModelId,
    count: 1,
    parameters: {},
    source: "manual"
  });
}

async function waitForJob(
  jobs: JobRepository,
  jobId: string,
  status: "running" | "succeeded" | "failed" | "cancelled",
  timeoutMs = 3_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.findById(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} did not reach ${status}.`);
}
