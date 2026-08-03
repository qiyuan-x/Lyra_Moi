import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetService,
  ModelGenerationService
} from "@lyra/core";
import type {
  BinaryModelProvider,
  ModelProviderResult
} from "@lyra/providers";
import {
  AssetRepository,
  ImmutableBlobStore,
  JobRepository,
  LyraDatabase,
  ProjectRepository,
  ProviderRepository,
  RuntimeEventRepository,
  SharpImageProcessor,
  ThumbnailStore,
  WorkerInstanceRepository,
  applyMigrations,
  lyraMigrations
} from "@lyra/storage";
import { JobWorkerRuntime, ModelJobExecutor } from "@lyra/worker";

const temporaryDirectories: string[] = [];
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const glb = createMinimalGlb();

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("model job worker", () => {
  it("persists provider progress and stores the completed GLB in the project", async () => {
    const fixture = await createFixture("complete");
    const provider = new FakeModelProvider(["running", "succeeded"]);
    const worker = createWorker(fixture, provider, "model-worker-complete");
    try {
      const job = await submitModelJob(fixture);
      worker.start();
      const completed = await waitForJob(fixture.jobs, job.id, "succeeded");
      expect(provider.submitCalls).toBe(1);
      expect(completed).toMatchObject({
        kind: "model.generate",
        progress: 100,
        externalTaskId: "remote-model-task",
        result: {
          outputCount: 1,
          externalTaskId: "remote-model-task",
          consumedCredits: 12
        }
      });
      expect(completed.outputs).toHaveLength(1);
      const outputId = completed.outputs[0]!.assetId;
      expect(fixture.assets.getAsset(outputId)).toMatchObject({
        kind: "model",
        source: "generated",
        mimeType: "model/gltf-binary"
      });
      expect((await fixture.assets.getContent(outputId)).data).toEqual(glb);
      expect(
        fixture.database.connection
          .prepare("SELECT blob_key FROM assets WHERE id = ?")
          .get(outputId)
      ).toMatchObject({
        blob_key: expect.stringContaining("/generated/models/")
      });
    } finally {
      await worker.stop();
      fixture.database.close();
    }
  });

  it("resumes an existing provider task after the worker stops without submitting twice", async () => {
    const fixture = await createFixture("resume");
    const firstProvider = new FakeModelProvider(["running", "running", "running"]);
    const firstWorker = createWorker(fixture, firstProvider, "model-worker-first");
    let resumedWorker: JobWorkerRuntime | null = null;
    try {
      const job = await submitModelJob(fixture);
      firstWorker.start();
      await waitForCheckpoint(fixture.jobs, job.id);
      await firstWorker.stop();
      expect(fixture.jobs.findById(job.id)).toMatchObject({
        status: "queued",
        stage: "resuming",
        externalTaskId: "remote-model-task"
      });

      const resumedProvider = new FakeModelProvider(["succeeded"]);
      resumedWorker = createWorker(fixture, resumedProvider, "model-worker-resumed");
      resumedWorker.start();
      const completed = await waitForJob(fixture.jobs, job.id, "succeeded");
      expect(completed.externalTaskId).toBe("remote-model-task");
      expect(resumedProvider.submitCalls).toBe(0);
      await resumedWorker.stop();
    } finally {
      await resumedWorker?.stop();
      await firstWorker.stop();
      fixture.database.close();
    }
  });

  it("reuses a completed remote task when local model saving is retried", async () => {
    const fixture = await createFixture("local-retry");
    try {
      const submitted = await submitModelJob(fixture);
      const claimed = fixture.jobs.claimNext("model-worker-local-retry", ["model.generate"]);
      expect(claimed?.id).toBe(submitted.id);
      fixture.jobs.updateProviderCheckpoint(
        submitted.id,
        "model-worker-local-retry",
        {
          externalTaskId: "paid-provider-task",
          progress: 95,
          stage: "downloading",
          providerState: { status: "succeeded" }
        }
      );
      fixture.jobs.fail(
        submitted.id,
        "model-worker-local-retry",
        "JOB_EXECUTION_FAILED",
        "Local model write failed."
      );
      expect(fixture.jobs.retry(submitted.id)).toMatchObject({
        status: "queued",
        stage: "resuming",
        externalTaskId: "paid-provider-task",
        progress: 95
      });
    } finally {
      fixture.database.close();
    }
  });
});

class FakeModelProvider implements BinaryModelProvider {
  submitCalls = 0;
  readonly #states: Array<"running" | "succeeded">;

  constructor(states: Array<"running" | "succeeded">) {
    this.#states = [...states];
  }

  async submit(): Promise<string> {
    this.submitCalls += 1;
    return "remote-model-task";
  }

  async query(): Promise<ModelProviderResult> {
    const state = this.#states.shift() ?? "running";
    if (state === "running") return { status: "running", progress: 62 };
    return {
      status: "succeeded",
      progress: 100,
      modelUrls: { glb: "https://provider.example/model.glb" },
      consumedCredits: 12
    };
  }

  async download() {
    return [{
      data: Buffer.from(glb),
      format: "glb" as const,
      extension: "glb",
      mimeType: "model/gltf-binary",
      name: "generated-model.glb"
    }];
  }
}

async function createFixture(suffix: string) {
  const directory = await mkdtemp(join(tmpdir(), `lyra-model-worker-${suffix}-`));
  temporaryDirectories.push(directory);
  const database = new LyraDatabase(join(directory, "database", "lyra.sqlite3"));
  applyMigrations(database.connection, lyraMigrations);
  const projects = new ProjectRepository(database);
  const project = projects.ensureDefaultProject("Model test");
  const providerRepository = new ProviderRepository(database);
  const profile = providerRepository.createProfile({
    id: `model-profile-${suffix}`,
    serviceType: "model",
    name: "Model provider",
    protocol: "openai-compatible",
    adapterType: "meshy",
    baseUrl: "https://api.meshy.ai",
    apiKeyEnvironmentVariable: `LYRA_TEST_MODEL_${suffix.toUpperCase()}`
  });
  const model = providerRepository.createModel(profile.id, {
    serviceType: "model",
    remoteModelId: "meshy-6",
    displayName: "Meshy 6",
    enabled: true,
    isDefault: true
  });
  const events = new RuntimeEventRepository(database);
  const jobs = new JobRepository(database, events);
  const assets = new AssetService({
    assets: new AssetRepository(database),
    blobs: new ImmutableBlobStore(join(directory, "projects")),
    thumbnails: new ThumbnailStore(join(directory, "projects")),
    images: new SharpImageProcessor()
  });
  const image = await assets.storeGeneratedImage({
    projectId: project.id,
    data: onePixelPng,
    name: "model-input",
    claimedMimeType: "image/png"
  });
  return {
    directory,
    database,
    projects,
    project,
    providerRepository,
    profile,
    model,
    jobs,
    assets,
    image,
    workers: new WorkerInstanceRepository(database)
  };
}

async function submitModelJob(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return new ModelGenerationService({
    projects: fixture.projects,
    assets: new AssetRepository(fixture.database),
    providers: fixture.providerRepository,
    jobs: fixture.jobs
  }).submit(fixture.project.id, {
    imageAssetId: fixture.image.id,
    providerProfileId: fixture.profile.id,
    providerModelId: fixture.model.id,
    outputFormats: ["glb"],
    parameters: { texture: true, pbr: true, targetFaceCount: 100_000 }
  });
}

function createWorker(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  provider: BinaryModelProvider,
  workerId: string
) {
  return new JobWorkerRuntime({
    jobs: fixture.jobs,
    workers: fixture.workers,
    executor: new ModelJobExecutor({
      providerResolver: { resolve: () => provider },
      assets: fixture.assets,
      jobs: fixture.jobs,
      pollIntervalMs: 250
    }),
    workerId,
    version: "test-v1",
    kinds: ["model.generate"],
    workerKind: "model",
    pollIntervalMs: 10,
    heartbeatIntervalMs: 20,
    cancellationPollIntervalMs: 10,
    staleLockTimeoutMs: 1_000,
    executionTimeoutMs: 5_000
  });
}

async function waitForJob(
  jobs: JobRepository,
  jobId: string,
  status: "succeeded",
  timeoutMs = 4_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.findById(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} did not reach ${status}.`);
}

async function waitForCheckpoint(
  jobs: JobRepository,
  jobId: string,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.findById(jobId);
    if (job?.status === "running" && job.externalTaskId) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} did not persist a provider checkpoint.`);
}

function createMinimalGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}   ', "utf8");
  const output = Buffer.alloc(20 + json.length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  return output;
}
