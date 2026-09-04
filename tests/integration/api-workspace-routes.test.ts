import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer } from "@lyra/api";
import {
  AgentConversationService,
  AssetService,
  ManualGenerationService,
  ModelGenerationService,
  PromptTemplateService,
  QueuedGenerationService,
  RuntimeEventFeed,
  WorkspaceQueryService
} from "@lyra/core";
import { ProviderRegistry, ProviderSettingsService } from "@lyra/providers";
import {
  AgentRunRepository,
  AgentStepRepository,
  AppSettingsRepository,
  AssetRepository,
  ConversationRepository,
  EnvironmentFileSecretStore,
  ImmutableBlobStore,
  JobRepository,
  ProjectDirectoryStore,
  ProjectAnimationStore,
  PromptPreviewStore,
  ProjectRepository,
  PromptTemplateRepository,
  ProviderRepository,
  RuntimeEventRepository,
  SharpImageProcessor,
  ThumbnailStore,
  createRuntimeLayout,
  migrateRuntimeDatabase,
  openReadyRuntimeDatabase
} from "@lyra/storage";
import { prepareM4Database } from "../fixtures/m4-database.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workspace HTTP routes", () => {
  it("supports the browser workflow without exposing internal checkpoints", async () => {
    const fixture = await createFixture();
    try {
      const projects = await getJson(fixture.baseUrl, "/api/v1/projects");
      expect(projects.status).toBe(200);
      expect(projects.body).toMatchObject({ items: [{ id: fixture.seed.projectId }] });
      const createdProject = await postJson(fixture.baseUrl, "/api/v1/projects", {
        name: "第二个项目",
        description: "独立工作区"
      });
      expect(createdProject).toMatchObject({
        status: 201,
        body: { project: { name: "第二个项目", description: "独立工作区" } }
      });
      const createdProjectId = readNestedString(createdProject.body, "project", "id");
      expect(await patchJson(fixture.baseUrl, `/api/v1/projects/${createdProjectId}`, {
        name: "修改后的项目",
        description: ""
      })).toMatchObject({ status: 200, body: { project: { name: "修改后的项目" } } });
      expect((await deleteJson(fixture.baseUrl, `/api/v1/projects/${createdProjectId}`)).status).toBe(200);

      const modeResponse = await patchJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}`,
        { lastImageMode: "manual" }
      );
      expect(modeResponse).toMatchObject({ status: 200, body: { project: { lastImageMode: "manual" } } });

      const providers = await getJson(fixture.baseUrl, "/api/v1/providers");
      expect(providers.status).toBe(200);
      if (!isRecord(providers.body) || !Array.isArray(providers.body.profiles)) {
        throw new Error("Provider response is invalid.");
      }
      expect(providers.body).toMatchObject({
        defaults: { llm: fixture.seed.llmModelId, image: fixture.seed.imageModelId, model: null }
      });
      expect(providers.body.profiles.filter((profile) =>
        isRecord(profile) && (
          profile.id === fixture.seed.providerProfileId ||
          profile.id === fixture.seed.llmProviderProfileId
        )
      )).toEqual([
        expect.objectContaining({
          id: fixture.seed.providerProfileId,
          serviceType: "image",
          hasApiKey: false
        }),
        expect.objectContaining({
          id: fixture.seed.llmProviderProfileId,
          serviceType: "llm",
          hasApiKey: false
        })
      ]);

      const promptList = await getJson(fixture.baseUrl, "/api/v1/prompts");
      expect(promptList.status).toBe(200);
      expect(JSON.stringify(promptList.body)).toContain('"id":"builtin-three-view"');
      const createdPrompt = await postJson(fixture.baseUrl, "/api/v1/prompts", {
        name: "我的模板",
        category: "测试",
        note: "Nano Banana 效果更好",
        content: "保持主体一致并修改背景",
        favorite: false
      });
      expect(createdPrompt).toMatchObject({
        status: 201,
        body: {
          prompt: {
            name: "我的模板",
            category: "测试",
            note: "Nano Banana 效果更好"
          }
        }
      });
      const promptId = readNestedString(createdPrompt.body, "prompt", "id");
      expect(await patchJson(fixture.baseUrl, `/api/v1/prompts/${promptId}`, { favorite: true })).toMatchObject({ status: 200, body: { prompt: { favorite: true } } });
      const previewForm = new FormData();
      previewForm.append("file", new Blob([PNG_1X1], { type: "image/png" }), "preview.png");
      const previewUpdate = await fetch(
        `${fixture.baseUrl}/api/v1/prompts/${promptId}/preview`,
        { method: "PUT", body: previewForm }
      );
      expect(previewUpdate.status).toBe(200);
      await expect(previewUpdate.json()).resolves.toMatchObject({
        prompt: { id: promptId, previewMimeType: "image/png" }
      });
      const previewContent = await fetch(`${fixture.baseUrl}/api/v1/prompts/${promptId}/preview`);
      expect(previewContent.status).toBe(200);
      expect(previewContent.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await previewContent.arrayBuffer())).toEqual(PNG_1X1);
      expect((await deleteJson(fixture.baseUrl, `/api/v1/prompts/${promptId}`)).status).toBe(200);
      expect(await patchJson(fixture.baseUrl, "/api/v1/prompts/builtin-three-view", { favorite: true })).toMatchObject({
        status: 200,
        body: { prompt: { favorite: true } }
      });

      const createdProvider = await postJson(fixture.baseUrl, "/api/v1/providers", {
        serviceType: "image",
        name: "Local API",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:9000/v1",
        apiKey: "local-secret"
      });
      expect(createdProvider.status).toBe(201);
      expect(JSON.stringify(createdProvider.body)).not.toContain("local-secret");
      const createdProviderId = readNestedString(createdProvider.body, "profile", "id");
      const frostProvider = await postJson(fixture.baseUrl, "/api/v1/providers", {
        serviceType: "llm",
        name: "FrostAPI",
        protocol: "openai-compatible",
        baseUrl: "https://api.linfrsot.cloud",
        apiKey: "sk-frost-test",
        settings: { __lyra: { providerKind: "frostapi" } }
      });
      const frostProviderId = readNestedString(frostProvider.body, "profile", "id");
      expect(await getJson(
        fixture.baseUrl,
        `/api/v1/providers/${frostProviderId}/usage`
      )).toMatchObject({
        status: 200,
        body: {
          usage: {
            mode: "unrestricted",
            planName: "钱包余额",
            balance: 5,
            remaining: 5,
            unit: "USD"
          }
        }
      });
      const createdModel = await postJson(fixture.baseUrl, `/api/v1/providers/${createdProviderId}/models`, {
        serviceType: "image",
        remoteModelId: "image-local",
        displayName: "Local Image"
      });
      const createdModelId = readNestedString(createdModel.body, "model", "id");
      expect((await putJson(fixture.baseUrl, "/api/v1/default-models/image", { modelId: createdModelId })).body).toMatchObject({ defaults: { image: createdModelId } });

      const form = new FormData();
      form.append("file", new Blob([PNG_1X1], { type: "image/png" }), "reference.png");
      const uploadResponse = await fetch(
        `${fixture.baseUrl}/api/v1/projects/${fixture.seed.projectId}/assets`,
        { method: "POST", body: form }
      );
      expect(uploadResponse.status).toBe(201);
      const uploaded = await uploadResponse.json() as { asset: { id: string; name: string } };
      expect(uploaded.asset.name).toBe("reference");

      const updatedAsset = await patchJson(fixture.baseUrl, `/api/v1/assets/${uploaded.asset.id}`, { name: "角色参考", tags: ["角色", "正面"] });
      expect(updatedAsset).toMatchObject({ status: 200, body: { asset: { name: "角色参考", tags: ["正面", "角色"] } } });
      expect(await getJson(fixture.baseUrl, `/api/v1/projects/${fixture.seed.projectId}/assets?tag=${encodeURIComponent("角色")}`)).toMatchObject({ status: 200, body: { items: [{ id: uploaded.asset.id }] } });

      const contentResponse = await fetch(`${fixture.baseUrl}/api/v1/assets/${uploaded.asset.id}/content`);
      expect(contentResponse.status).toBe(200);
      expect(Buffer.from(await contentResponse.arrayBuffer())).toEqual(PNG_1X1);
      const etag = contentResponse.headers.get("etag");
      expect(etag).toBeTruthy();
      expect((await fetch(`${fixture.baseUrl}/api/v1/assets/${uploaded.asset.id}/content`, {
        headers: { "If-None-Match": etag! }
      })).status).toBe(304);

      const animationBytes = Buffer.from("; FBX 7.4.0 project animation test");
      const animationForm = new FormData();
      animationForm.append(
        "file",
        new Blob([animationBytes], { type: "application/octet-stream" }),
        "walk.fbx"
      );
      animationForm.append("clips", JSON.stringify([{ name: "Walk", duration: 1.25 }]));
      const animationUploadResponse = await fetch(
        `${fixture.baseUrl}/api/v1/projects/${fixture.seed.projectId}/animations`,
        { method: "POST", body: animationForm }
      );
      expect(animationUploadResponse.status).toBe(201);
      const animationUpload = await animationUploadResponse.json() as {
        animation: { id: string; name: string };
      };
      expect(animationUpload.animation.name).toBe("walk");
      expect(await getJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/animations`
      )).toMatchObject({
        status: 200,
        body: { items: [{ id: animationUpload.animation.id, clips: [{ name: "Walk" }] }] }
      });
      const animationContent = await fetch(
        `${fixture.baseUrl}/api/v1/projects/${fixture.seed.projectId}/animations/${animationUpload.animation.id}/content`
      );
      expect(animationContent.status).toBe(200);
      expect(Buffer.from(await animationContent.arrayBuffer())).toEqual(animationBytes);
      expect((await deleteJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/animations/${animationUpload.animation.id}`
      )).status).toBe(200);

      const conversationResponse = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/conversations`,
        { title: "" }
      );
      expect(conversationResponse.status).toBe(201);
      const conversationId = readNestedString(conversationResponse.body, "conversation", "id");
      const managedConversation = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/conversations`,
        { title: "" }
      );
      const managedConversationId = readNestedString(managedConversation.body, "conversation", "id");
      expect(await patchJson(
        fixture.baseUrl,
        `/api/v1/conversations/${managedConversationId}`,
        { title: "重命名的对话" }
      )).toMatchObject({ status: 200, body: { conversation: { title: "重命名的对话" } } });
      const preservedGeneration = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/generations`,
        {
          conversationId: managedConversationId,
          prompt: "保留资源后删除对话",
          attachments: [{ assetId: uploaded.asset.id, label: "图一", position: 1 }],
          providerProfileId: fixture.seed.providerProfileId,
          providerModelId: fixture.seed.imageModelId,
          count: 1,
          parameters: { aspectRatio: "1:1" }
        }
      );
      const preservedJobId = readNestedString(
        preservedGeneration.body,
        "job",
        "id"
      );
      await postJson(fixture.baseUrl, `/api/v1/jobs/${preservedJobId}/cancel`);
      expect(await deleteJson(
        fixture.baseUrl,
        `/api/v1/conversations/${managedConversationId}`
      )).toMatchObject({
        status: 200,
        body: { conversation: { id: managedConversationId } }
      });
      expect(JSON.stringify((await getJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/conversations`
      )).body)).not.toContain(managedConversationId);
      expect(fixture.conversations.findById(managedConversationId, true)).toBeNull();
      expect(fixture.jobs.findById(preservedJobId)).toMatchObject({
        id: preservedJobId,
        conversationId: null,
        inputs: [{ assetId: uploaded.asset.id }]
      });
      expect(fixture.assets.findById(uploaded.asset.id)).not.toBeNull();
      await deleteJson(fixture.baseUrl, `/api/v1/jobs/${preservedJobId}`);
      expect(fixture.jobs.findById(preservedJobId)).toMatchObject({
        id: preservedJobId,
        dismissedAt: expect.any(String)
      });
      expect(fixture.database.connection.prepare("PRAGMA foreign_key_check").all())
        .toEqual([]);

      const agentResponse = await postJson(
        fixture.baseUrl,
        `/api/v1/conversations/${conversationId}/messages`,
        {
          text: "根据图一生成新的角色图",
          attachments: [{ assetId: uploaded.asset.id, label: "图1", position: 1 }]
        }
      );
      expect(agentResponse.status).toBe(202);
      const agentRunId = readNestedString(agentResponse.body, "agentRun", "id");
      expect(await getJson(fixture.baseUrl, `/api/v1/conversations/${conversationId}/messages`)).toMatchObject({
        status: 200,
        body: { items: [{ text: "根据图一生成新的角色图" }] }
      });

      fixture.steps.append({
        agentRunId,
        type: "tool_call",
        status: "running",
        toolName: "request_user_input",
        payload: { toolCallId: "tool-call-test", arguments: {} }
      });
      fixture.steps.saveUserInputCheckpoint(
        agentRunId,
        "tool-call-test",
        { prompt: "要继续吗？", choices: [{ id: "continue", label: "继续" }] },
        { secret: "checkpoint must not be returned" }
      );
      const steps = await getJson(fixture.baseUrl, `/api/v1/agent-runs/${agentRunId}/steps`);
      expect(JSON.stringify(steps.body)).toContain("要继续吗");
      expect(JSON.stringify(steps.body)).not.toContain("checkpoint must not be returned");

      const generation = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/generations`,
        {
          conversationId,
          prompt: "生成一个新的候选图",
          attachments: [{ assetId: uploaded.asset.id, label: "图1", position: 1 }],
          providerProfileId: createdProviderId,
          providerModelId: createdModelId,
          count: 1,
          parameters: { aspectRatio: "1:1" }
        }
      );
      expect(generation.status).toBe(202);
      const jobId = readNestedString(generation.body, "job", "id");

      const jobs = await getJson(fixture.baseUrl, `/api/v1/jobs?projectId=${fixture.seed.projectId}`);
      expect(jobs.status).toBe(200);
      expect(jobs.body).toMatchObject({
        items: [{ id: jobId, conversationId, source: "manual", status: "queued" }]
      });

      const cancelled = await postJson(fixture.baseUrl, `/api/v1/jobs/${jobId}/cancel`);
      expect(cancelled.status).toBe(202);
      expect(cancelled.body).toMatchObject({ job: { id: jobId, status: "cancelled" } });
      const retried = await postJson(
        fixture.baseUrl,
        `/api/v1/jobs/${jobId}/retry`,
        {
          providerProfileId: createdProviderId,
          providerModelId: createdModelId
        }
      );
      expect(retried.status).toBe(202);
      expect(retried.body).toMatchObject({
        job: {
          retryOfJobId: jobId,
          status: "queued",
          providerProfileId: createdProviderId,
          providerModelId: createdModelId
        }
      });
      const retriedJobId = readNestedString(retried.body, "job", "id");
      const visibleAfterRetry = await getJson(
        fixture.baseUrl,
        `/api/v1/jobs?projectId=${fixture.seed.projectId}`
      );
      expect(visibleAfterRetry.body).toMatchObject({
        items: [{ id: retriedJobId, status: "queued" }]
      });
      await postJson(fixture.baseUrl, `/api/v1/jobs/${retriedJobId}/cancel`);
      const dismissed = await deleteJson(fixture.baseUrl, `/api/v1/jobs/${retriedJobId}`);
      expect(dismissed.body).toMatchObject({
        job: { id: retriedJobId, dismissedAt: expect.any(String) }
      });
      const cleared = await deleteJson(
        fixture.baseUrl,
        `/api/v1/jobs?projectId=${fixture.seed.projectId}`
      );
      expect(cleared.body).toMatchObject({ dismissedCount: 0 });
      expect(
        (await getJson(fixture.baseUrl, `/api/v1/jobs?projectId=${fixture.seed.projectId}`)).body
      ).toMatchObject({ items: [] });

      const modelProvider = await postJson(fixture.baseUrl, "/api/v1/providers", {
        serviceType: "model",
        name: "Meshy",
        protocol: "openai-compatible",
        adapterType: "meshy",
        baseUrl: "https://api.meshy.ai",
        apiKey: "model-secret"
      });
      expect(modelProvider.status).toBe(201);
      const modelProviderId = readNestedString(modelProvider.body, "profile", "id");
      const modelProviderModel = await postJson(
        fixture.baseUrl,
        `/api/v1/providers/${modelProviderId}/models`,
        {
          serviceType: "model",
          remoteModelId: "meshy-6",
          displayName: "Meshy 6"
        }
      );
      const modelProviderModelId = readNestedString(modelProviderModel.body, "model", "id");
      const textureForm = new FormData();
      textureForm.append(
        "file",
        new Blob([PNG_1X1], { type: "image/png" }),
        "texture-reference.png"
      );
      const textureUploadResponse = await fetch(
        `${fixture.baseUrl}/api/v1/projects/${fixture.seed.projectId}/assets`,
        { method: "POST", body: textureForm }
      );
      expect(textureUploadResponse.status).toBe(201);
      const textureUpload = await textureUploadResponse.json() as {
        asset: { id: string };
      };
      const modelGeneration = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${fixture.seed.projectId}/model-generations`,
        {
          imageAssetId: uploaded.asset.id,
          textureImageAssetId: textureUpload.asset.id,
          providerProfileId: modelProviderId,
          providerModelId: modelProviderModelId,
          outputFormats: ["glb"],
          parameters: { texture: true, pbr: true, targetFaceCount: 100000 }
        }
      );
      expect(modelGeneration).toMatchObject({
        status: 202,
        body: {
          job: {
            kind: "model.generate",
            status: "queued",
            inputs: [
              { assetId: uploaded.asset.id, label: "模型输入图" },
              { assetId: textureUpload.asset.id, label: "纹理输入图" }
            ]
          }
        }
      });
      const modelJobId = readNestedString(modelGeneration.body, "job", "id");
      await postJson(fixture.baseUrl, `/api/v1/jobs/${modelJobId}/cancel`);
      await deleteJson(fixture.baseUrl, `/api/v1/jobs/${modelJobId}`);

      const invalid = await postJson(fixture.baseUrl, `/api/v1/projects/${fixture.seed.projectId}/generations`, {});
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ error: { code: "VALIDATION_ERROR" }, requestId: expect.any(String) });
      expect((await deleteJson(fixture.baseUrl, `/api/v1/provider-models/${createdModelId}`)).status).toBe(200);
      expect((await deleteJson(fixture.baseUrl, `/api/v1/providers/${createdProviderId}`)).status).toBe(200);
      expect((await deleteJson(fixture.baseUrl, `/api/v1/assets/${uploaded.asset.id}`)).body).toMatchObject({ asset: { deletedAt: expect.any(String) } });
    } finally {
      await fixture.close();
    }
  });

  it("permanently deletes a project and its isolated data", async () => {
    const fixture = await createFixture();
    try {
      const createdProject = await postJson(fixture.baseUrl, "/api/v1/projects", {
        name: "待删除项目",
        description: "验证永久删除"
      });
      const projectId = readNestedString(createdProject.body, "project", "id");
      const projectDirectory = join(fixture.layout.projects, projectId);
      expect(existsSync(projectDirectory)).toBe(true);

      const createdConversation = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${projectId}/conversations`,
        { title: "待删除对话" }
      );
      const conversationId = readNestedString(
        createdConversation.body,
        "conversation",
        "id"
      );
      const form = new FormData();
      form.append("file", new Blob([PNG_1X1], { type: "image/png" }), "delete-me.png");
      const uploadResponse = await fetch(
        `${fixture.baseUrl}/api/v1/projects/${projectId}/assets`,
        { method: "POST", body: form }
      );
      expect(uploadResponse.status).toBe(201);
      const uploaded = await uploadResponse.json() as { asset: { id: string } };

      const generation = await postJson(
        fixture.baseUrl,
        `/api/v1/projects/${projectId}/generations`,
        {
          conversationId,
          prompt: "创建一个待删除任务",
          attachments: [{ assetId: uploaded.asset.id, label: "图一", position: 1 }],
          providerProfileId: fixture.seed.providerProfileId,
          providerModelId: fixture.seed.imageModelId,
          count: 1,
          parameters: { aspectRatio: "1:1" }
        }
      );
      const jobId = readNestedString(generation.body, "job", "id");
      expect((await postJson(fixture.baseUrl, `/api/v1/jobs/${jobId}/cancel`)).status).toBe(202);

      expect((await deleteJson(fixture.baseUrl, `/api/v1/projects/${projectId}`)).status).toBe(200);
      expect(fixture.projects.findById(projectId)).toBeNull();
      expect(existsSync(projectDirectory)).toBe(false);
      expect(readCount(fixture.database.connection, "conversations", projectId)).toBe(0);
      expect(readCount(fixture.database.connection, "assets", projectId)).toBe(0);
      expect(readCount(fixture.database.connection, "jobs", projectId)).toBe(0);
      expect(readCount(fixture.database.connection, "runtime_events", projectId)).toBe(0);
    } finally {
      await fixture.close();
    }
  });
});

async function createFixture() {
  const parent = await mkdtemp(join(tmpdir(), "lyra-api-workspace-"));
  temporaryDirectories.push(parent);
  const layout = createRuntimeLayout(join(parent, "data"));
  await migrateRuntimeDatabase(layout);
  const database = await openReadyRuntimeDatabase(layout);
  const seed = prepareM4Database(database);
  const projects = new ProjectRepository(database);
  const conversations = new ConversationRepository(database);
  const agentRuns = new AgentRunRepository(database);
  const steps = new AgentStepRepository(database);
  const assets = new AssetRepository(database);
  const providers = new ProviderRepository(database);
  const prompts = new PromptTemplateRepository(database);
  const jobs = new JobRepository(database);
  const events = new RuntimeEventRepository(database);
  const settings = new AppSettingsRepository(database);
  settings.set("default_llm_model_id", seed.llmModelId);
  settings.set("default_image_model_id", seed.imageModelId);
  const assetService = new AssetService({
    assets,
    blobs: new ImmutableBlobStore(layout.projects, layout.blobs),
    thumbnails: new ThumbnailStore(layout.projects, layout.thumbnails),
    images: new SharpImageProcessor()
  });
  const queuedGenerations = new QueuedGenerationService(jobs);
  const server = createApiServer({
    events: new RuntimeEventFeed(events),
    workspace: new WorkspaceQueryService({
      projects,
      conversations,
      agentRuns,
      agentSteps: steps,
      jobs,
      projectDirectories: new ProjectDirectoryStore(layout.projects)
    }),
    conversations: new AgentConversationService({ database, conversations, agentRuns, agentSteps: steps, providers, settings, assets, events }),
    manualGenerations: new ManualGenerationService({
      projects,
      conversations,
      assets,
      providers,
      generations: queuedGenerations
    }),
    modelGenerations: new ModelGenerationService({
      projects,
      assets,
      providers,
      jobs
    }),
    assets: assetService,
    projectAnimations: new ProjectAnimationStore(layout.projects, projects),
    providers: new ProviderSettingsService({
      providers,
      settings,
      secrets: new EnvironmentFileSecretStore(layout.environmentFile),
      registry: new ProviderRegistry(),
      frostApiUsage: {
        async query() {
          return {
            mode: "unrestricted",
            planName: "钱包余额",
            balance: 5,
            remaining: 5,
            unit: "USD"
          };
        }
      }
    }),
    prompts: new PromptTemplateService({
      prompts,
      previews: new PromptPreviewStore(layout.promptPreviews)
    })
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    seed,
    steps,
    layout,
    database,
    projects,
    conversations,
    assets,
    jobs,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    }
  };
}

async function getJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() as unknown };
}

async function postJson(baseUrl: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as unknown };
}

async function patchJson(baseUrl: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as unknown };
}

async function putJson(baseUrl: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as unknown };
}

async function deleteJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
  return { status: response.status, body: await response.json() as unknown };
}

function readNestedString(value: unknown, parent: string, key: string): string {
  if (!isRecord(value) || !isRecord(value[parent]) || typeof value[parent][key] !== "string") {
    throw new Error(`Response is missing ${parent}.${key}.`);
  }
  return value[parent][key];
}

function readCount(
  connection: { prepare(sql: string): { get(...values: unknown[]): unknown } },
  table: "conversations" | "assets" | "jobs" | "runtime_events",
  projectId: string
): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`)
    .get(projectId);
  if (!isRecord(row) || typeof row.count !== "number") {
    throw new Error(`Could not count ${table}.`);
  }
  return row.count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
