import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AgentConversationService,
  AgentPromptSettingsService,
  AgentRuntimeSettingsService,
  AssetService,
  CommunitySettingsService,
  ManualGenerationService,
  ModelGenerationService,
  PromptTemplateService,
  QueuedGenerationService,
  RuntimeEventFeed,
  WorkspaceQueryService,
  loadAgentPromptDefaults
} from "@lyra/core";
import { createHttpProviderRegistry, ProviderSettingsService } from "@lyra/providers";
import {
  createRuntimeRepositories,
  EnvironmentFileSecretStore,
  ImmutableBlobStore,
  ProjectDirectoryStore,
  ProjectAnimationStore,
  PromptPreviewStore,
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
import { createApiServer } from "./server.js";
import { ApplicationUpdateService } from "./application-update-service.js";

export interface CreateApiRuntimeOptions {
  dataDirectory?: string;
  webRoot?: string;
  workerVersion?: string;
  accessToken?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  appVersion?: string;
  applicationBaseDirectory?: string;
  deploymentMode?: string;
  updateManifestUrl?: string;
  updateHelperCommand?: string[];
  applicationPort?: number;
}

export interface ApiRuntime {
  database: LyraDatabase;
  layout: RuntimeLayout;
  server: ReturnType<typeof createApiServer>;
  defaultProjectId: string;
  close(): Promise<void>;
}

export async function createApiRuntime(options: CreateApiRuntimeOptions = {}): Promise<ApiRuntime> {
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
      projects,
      conversations,
      agentRuns,
      agentSteps,
      assets,
      providers,
      settings,
      jobs,
      prompts,
      workers
    } = createRuntimeRepositories(database);
    const assetService = new AssetService({
      assets,
      blobs: new ImmutableBlobStore(layout.projects, layout.blobs),
      thumbnails: new ThumbnailStore(layout.projects, layout.thumbnails),
      images: new SharpImageProcessor()
    });
    const generations = new QueuedGenerationService(jobs);
    const defaultProject = projects.ensureDefaultProject();
    const projectDirectories = new ProjectDirectoryStore(layout.projects);
    projectDirectories.ensure(defaultProject.id);
    const projectAnimations = new ProjectAnimationStore(layout.projects, projects);
    const secretStore = new EnvironmentFileSecretStore(layout.environmentFile);

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
    const agentRuntimeSettings = new AgentRuntimeSettingsService(settings);
    const communitySettings = new CommunitySettingsService(settings);
    const applicationUpdates = new ApplicationUpdateService({
      currentVersion: options.appVersion?.trim() || "0.0.5",
      baseDirectory: options.applicationBaseDirectory?.trim() || process.cwd(),
      stateFile: resolve(layout.run, "application-update-state.json"),
      requestFile: resolve(layout.run, "application-update-request.json"),
      ...(options.updateManifestUrl?.trim()
        ? { manifestUrl: options.updateManifestUrl.trim() }
        : {}),
      ...(options.updateHelperCommand?.length
        ? { helperCommand: options.updateHelperCommand }
        : {}),
      ...(options.deploymentMode?.trim()
        ? { deploymentMode: options.deploymentMode.trim() }
        : {}),
      ...(options.applicationPort ? { port: options.applicationPort } : {})
    });
    void applicationUpdates.check().catch(() => undefined);
    const server = createApiServer({
      events: new RuntimeEventFeed(runtimeEvents),
      workspace: new WorkspaceQueryService({
        projects,
        conversations,
        agentRuns,
        agentSteps,
        jobs,
        projectDirectories
      }),
      conversations: new AgentConversationService({
        database,
        conversations,
        agentRuns,
        agentSteps,
        providers,
        settings,
        assets,
        events: runtimeEvents
      }),
      manualGenerations: new ManualGenerationService({
        projects,
        conversations,
        assets,
        providers,
        generations
      }),
      modelGenerations: new ModelGenerationService({
        projects,
        assets,
        providers,
        jobs
      }),
      assets: assetService,
      projectAnimations,
      providers: new ProviderSettingsService({
        providers,
        settings,
        secrets: secretStore,
        registry: createHttpProviderRegistry()
      }),
      prompts: new PromptTemplateService({
        prompts,
        previews: new PromptPreviewStore(layout.promptPreviews)
      }),
      agentPromptSettings,
      agentRuntimeSettings,
      communitySettings,
      applicationUpdates,
      readiness: () => {
        const workerVersion = options.workerVersion?.trim() || options.appVersion?.trim() || "0.0.5";
        const heartbeatCutoff = new Date(Date.now() - 5_000).toISOString();
        const webReady =
          !options.webRoot?.trim() || existsSync(resolve(options.webRoot, "index.html"));
        const workerReady =
          workers.isReady("agent", workerVersion, heartbeatCutoff) &&
          workers.isReady("image", workerVersion, heartbeatCutoff) &&
          workers.isReady("model", workerVersion, heartbeatCutoff);
        return {
          ok: webReady && workerReady,
          database: "ready",
          web: webReady ? "ready" : "not_ready",
          worker: workerReady ? "ready" : "not_ready"
        };
      },
      ...(options.webRoot?.trim() ? { webRoot: options.webRoot } : {}),
      ...(options.accessToken?.trim() ? { accessToken: options.accessToken.trim() } : {})
    });

    let closed = false;
    return {
      database,
      layout,
      server,
      defaultProjectId: defaultProject.id,
      async close() {
        if (closed) return;
        closed = true;
        if (server.listening) {
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => error ? rejectClose(error) : resolveClose());
            server.closeAllConnections();
          });
        }
        database.close();
      }
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
