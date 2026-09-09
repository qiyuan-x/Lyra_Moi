import {
  AgentPromptSettingsService,
  AssetService,
  ModelGenerationService,
  QueuedGenerationService,
  PromptTemplateService,
  WorkspaceQueryService,
  TaskRuntimeSettingsService,
  MIN_MODEL_GENERATION_CONCURRENCY,
  MAX_MODEL_GENERATION_CONCURRENCY,
  loadAgentPromptDefaults
} from "@lyra/core";
import {
  RuntimeImageProviderResolver,
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
  synchronizeProjectFolders,
  resolveDataDirectory,
  type LyraDatabase,
  type RuntimeLayout
} from "@lyra/storage";
import { AgentSessionWorker } from "./agent-session-worker.js";
import { ImageJobExecutor } from "./image-job-executor.js";
import { JobWorkerRuntime } from "./job-worker-runtime.js";
import { DynamicJobWorkerPool } from "./dynamic-job-worker-pool.js";
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
  readonly modelWorkers: readonly JobWorkerRuntime[];
  agentWorker: AgentSessionWorker;
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
    const folderReport = await synchronizeProjectFolders(database, layout);
    for (const error of folderReport.errors) console.error("Project folder import failed", error);
    const repositories = createRuntimeRepositories(database);
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
    } = repositories;
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
    const version = options.version?.trim() || "0.1.4";
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
    const taskRuntimeSettings = new TaskRuntimeSettingsService(settings);
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
    const modelExecutor = new ModelJobExecutor({
      providerResolver: new RuntimeModelProviderResolver(providerFactory),
      assets: assetService,
      jobs
    });
    const modelWorkerPool = new DynamicJobWorkerPool({
      createWorker: (canClaim) => new JobWorkerRuntime({
        canClaim,
        jobs,
        workers,
        executor: modelExecutor,
        version,
        pid,
        kinds: ["model.generate"],
        workerKind: "model",
        executionTimeoutMs: 55 * 60_000
      }),
      readConcurrency: () => taskRuntimeSettings.get().modelGenerationConcurrency,
      minimumConcurrency: MIN_MODEL_GENERATION_CONCURRENCY,
      maximumConcurrency: MAX_MODEL_GENERATION_CONCURRENCY
    });
    const modelWorker = modelWorkerPool.workers[0]!;
    const agentWorker = new AgentSessionWorker({
      database,
      repositories,
      services: {
        assets: assetService, generations, modelGenerations,
        workspace: new WorkspaceQueryService({ projects, conversations, agentRuns, agentSteps, jobs, projectDirectories }),
        prompts: new PromptTemplateService({ prompts: repositories.prompts })
      },
      models: { resolve: (profileId, modelId) => providerFactory.createAgentModel(profileId, modelId) },
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
      get modelWorkers() {
        return modelWorkerPool.workers;
      },
      agentWorker,
      start() {
        if (closed) throw new Error("Worker runtime is closed.");
        if (started) throw new Error("Worker runtime is already started.");
        imageWorker.start();
        try {
          modelWorkerPool.start();
          agentWorker.start();
          started = true;
        } catch (error) {
          void modelWorkerPool.stop();
          void imageWorker.stop();
          throw error;
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        if (started) {
          await agentWorker.stop();
          await modelWorkerPool.stop();
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
