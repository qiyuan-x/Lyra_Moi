import {
  AgentPromptSettingsService,
  AssetService,
  ModelGenerationService,
  QueuedGenerationService,
  loadAgentPromptDefaults
} from "@lyra/core";
import {
  RuntimeImageProviderResolver,
  RuntimeLlmProviderResolver,
  RuntimeModelProviderResolver,
  RuntimeProviderFactory
} from "@lyra/providers";
import {
  createRuntimeRepositories,
  EnvironmentFileSecretStore,
  ImmutableBlobStore,
  ProjectDirectoryStore,
  openReadyRuntimeDatabase,
  SharpImageProcessor,
  ThumbnailStore,
  WorkerInstanceRepository,
  createRuntimeLayout,
  migrateRuntimeDatabase,
  migrateLegacyProjectAssets,
  resolveDataDirectory,
  type LyraDatabase,
  type RuntimeLayout
} from "@lyra/storage";
import { AgentWorkerRuntime } from "./agent-worker-runtime.js";
import { ImageJobExecutor } from "./image-job-executor.js";
import { JobWorkerRuntime } from "./job-worker-runtime.js";
import { ModelJobExecutor } from "./model-job-executor.js";

export interface CreateWorkerRuntimeOptions {
  dataDirectory?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  version?: string;
  pid?: number | null;
}

export interface WorkerRuntime {
  database: LyraDatabase;
  layout: RuntimeLayout;
  imageWorker: JobWorkerRuntime;
  modelWorker: JobWorkerRuntime;
  agentWorker: AgentWorkerRuntime;
  start(): void;
  close(): Promise<void>;
}

export async function createWorkerRuntime(
  options: CreateWorkerRuntimeOptions = {}
): Promise<WorkerRuntime> {
  const dataDirectory = resolveDataDirectory(
    options.dataDirectory === undefined ? {} : { explicitDataDirectory: options.dataDirectory }
  );
  const layout = createRuntimeLayout(dataDirectory);
  await migrateRuntimeDatabase(layout);
  const database = await openReadyRuntimeDatabase(layout);

  try {
    await migrateLegacyProjectAssets(database, layout);
    const {
      runtimeEvents,
      conversations,
      agentRuns,
      agentSteps,
      assets,
      jobs,
      workers,
      providers,
      settings,
      projects
    } = createRuntimeRepositories(database);
    const generations = new QueuedGenerationService(jobs);
    const modelGenerations = new ModelGenerationService({
      projects,
      assets,
      providers,
      jobs
    });
    const projectDirectories = new ProjectDirectoryStore(layout.projects);
    for (const project of projects.listActive()) {
      projectDirectories.ensure(project.id);
    }
    const assetService = new AssetService({
      assets,
      blobs: new ImmutableBlobStore(layout.projects, layout.blobs),
      thumbnails: new ThumbnailStore(layout.projects, layout.thumbnails),
      images: new SharpImageProcessor()
    });
    const providerFactory = new RuntimeProviderFactory({
      providers,
      secrets: new EnvironmentFileSecretStore(layout.environmentFile),
      assets: assetService
    });
    const version = options.version?.trim() || "0.1.0";
    const pid = options.pid ?? process.pid;
    const agentPromptSettings = new AgentPromptSettingsService(
      settings,
      await loadAgentPromptDefaults({
        ...(options.systemPrompt
          ? { systemPrompt: options.systemPrompt }
          : {}),
        ...(options.systemPromptFile
          ? { systemPromptFile: options.systemPromptFile }
          : {})
      })
    );
    const imageWorker = new JobWorkerRuntime({
      jobs,
      workers,
      agentRuns,
      executor: new ImageJobExecutor({
        providerResolver: new RuntimeImageProviderResolver(providerFactory),
        assets: assetService
      }),
      version,
      pid
    });
    const modelWorker = new JobWorkerRuntime({
      jobs,
      workers,
      executor: new ModelJobExecutor({
        providerResolver: new RuntimeModelProviderResolver(providerFactory),
        assets: assetService,
        jobs
      }),
      version,
      pid,
      kinds: ["model.generate"],
      workerKind: "model",
      executionTimeoutMs: 55 * 60_000
    });
    const agentWorker = new AgentWorkerRuntime({
      database,
      agentRuns,
      agentSteps,
      jobs,
      conversations,
      runtimeEvents,
      workers,
      generations,
      modelGenerations,
      providers,
      settings,
      llmProviders: new RuntimeLlmProviderResolver(providerFactory),
      promptSettings: agentPromptSettings,
      version,
      pid
    });

    let started = false;
    let closed = false;
    return {
      database,
      layout,
      imageWorker,
      modelWorker,
      agentWorker,
      start() {
        if (closed) throw new Error("Worker runtime is closed.");
        if (started) throw new Error("Worker runtime is already started.");
        imageWorker.start();
        try {
          modelWorker.start();
          agentWorker.start();
          started = true;
        } catch (error) {
          void modelWorker.stop();
          void imageWorker.stop();
          throw error;
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        if (started) {
          await agentWorker.stop();
          await modelWorker.stop();
          await imageWorker.stop();
        }
        database.close();
      }
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
