import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  LlmCompletion,
  LlmCompletionInput,
  LlmProvider
} from "@lyra/agent-engine";
import {
  AgentConversationService,
  AgentPromptSettingsService,
  AssetService,
  ModelGenerationService,
  QueuedGenerationService
} from "@lyra/core";
import type {
  BinaryModelProvider,
  ModelProviderResult
} from "@lyra/providers";
import { FakeBinaryImageProvider } from "@lyra/providers";
import {
  AgentRunRepository,
  AgentStepRepository,
  AppSettingsRepository,
  AssetRepository,
  ConversationRepository,
  ImmutableBlobStore,
  JobRepository,
  LyraDatabase,
  ProjectRepository,
  ProviderRepository,
  RuntimeEventRepository,
  SharpImageProcessor,
  ThumbnailStore,
  WorkerInstanceRepository
} from "@lyra/storage";
import {
  AgentWorkerRuntime,
  ImageJobExecutor,
  JobWorkerRuntime,
  ModelJobExecutor,
  type AgentLlmProviderResolver
} from "@lyra/worker";
import { prepareM4Database } from "../fixtures/m4-database.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const MINIMAL_GLB = createMinimalGlb();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

class ScriptedLlmProvider implements LlmProvider {
  readonly inputs: Array<Omit<LlmCompletionInput, "signal">> = [];
  readonly #responses: LlmCompletion[];

  constructor(responses: LlmCompletion[]) {
    this.#responses = [...responses];
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    input.signal?.throwIfAborted();
    this.inputs.push({
      messages: structuredClone(input.messages),
      tools: structuredClone(input.tools)
    });
    const response = this.#responses.shift();
    if (!response) throw new Error("Scripted LLM response is missing.");
    return structuredClone(response);
  }
}

class ImageThenModelLlmProvider implements LlmProvider {
  readonly inputs: Array<Omit<LlmCompletionInput, "signal">> = [];
  #imageAssetId = "";
  #completionCount = 0;

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    input.signal?.throwIfAborted();
    this.inputs.push({
      messages: structuredClone(input.messages),
      tools: structuredClone(input.tools)
    });
    this.#completionCount += 1;
    if (this.#completionCount === 1) {
      return {
        type: "tool_call",
        call: {
          id: "call-image-before-model",
          name: "generate_image",
          arguments: { prompt: "生成适合建模的角色正视图", count: 1 }
        }
      };
    }
    if (this.#completionCount === 2) {
      const toolContent = input.messages.at(-1)?.content ?? "";
      const result = JSON.parse(toolContent) as {
        outputs?: Array<{ assetId?: unknown }>;
      };
      const assetId = result.outputs?.[0]?.assetId;
      if (typeof assetId !== "string" || !assetId) {
        throw new Error("Image result did not include an asset ID.");
      }
      this.#imageAssetId = assetId;
      return this.#modelToolCall("call-model-approval");
    }
    if (this.#completionCount === 3) {
      return this.#modelToolCall("call-model-approved");
    }
    return { type: "message", text: "图片和模型均已生成，请验收。" };
  }

  #modelToolCall(id: string): LlmCompletion {
    return {
      type: "tool_call",
      call: {
        id,
        name: "generate_model",
        arguments: {
          imageAssetId: this.#imageAssetId,
          outputFormats: ["glb"],
          parameters: { texture: true, pbr: true, targetFaceCount: 30_000 }
        }
      }
    };
  }
}

class FakeModelProvider implements BinaryModelProvider {
  submitCalls = 0;

  async submit(): Promise<string> {
    this.submitCalls += 1;
    return "remote-agent-model";
  }

  async query(): Promise<ModelProviderResult> {
    return {
      status: "succeeded",
      progress: 100,
      modelUrls: { glb: "https://provider.example/agent-model.glb" }
    };
  }

  async download() {
    return [{
      data: Buffer.from(MINIMAL_GLB),
      format: "glb" as const,
      extension: "glb",
      mimeType: "model/gltf-binary",
      name: "agent-model.glb"
    }];
  }
}

describe("persistent Agent runtime", () => {
  it("reads the latest Agent prompt settings for each new run", async () => {
    const llm = new ScriptedLlmProvider([
      { type: "message", text: "第一轮完成" },
      { type: "message", text: "第二轮完成" }
    ]);
    const fixture = await createFixture("dynamic-agent-prompts", llm);
    const agentWorker = fixture.createAgentWorker(
      "agent-worker-dynamic-prompts"
    );
    try {
      agentWorker.start();
      const firstConversation = fixture.agentService.createConversation(
        fixture.seed.projectId
      );
      const first = fixture.agentService.sendMessage(
        firstConversation.id,
        { text: "第一轮", attachments: [] }
      );
      await waitForAgent(
        fixture.agentRuns,
        first.agentRun.id,
        "completed",
        5_000
      );

      fixture.promptSettings.update({
        systemPrompt: "这是修改后的系统提示词。",
        optimizeEnabledPrompt: "这是修改后的优化规则。"
      });
      fixture.settings.set("agent_max_tool_calls", 17);
      const secondConversation = fixture.agentService.createConversation(
        fixture.seed.projectId
      );
      const second = fixture.agentService.sendMessage(
        secondConversation.id,
        { text: "第二轮", attachments: [] }
      );
      await waitForAgent(
        fixture.agentRuns,
        second.agentRun.id,
        "completed",
        5_000
      );

      expect(llm.inputs[0]?.messages.slice(0, 2).map(
        (message) => message.content
      )).toEqual([
        "默认 Agent 系统提示词。",
        "默认优化规则。"
      ]);
      expect(llm.inputs[1]?.messages.slice(0, 2).map(
        (message) => message.content
      )).toEqual([
        "这是修改后的系统提示词。",
        "这是修改后的优化规则。"
      ]);
      expect(fixture.agentRuns.requireStored(second.agentRun.id).maxToolCalls)
        .toBe(17);
    } finally {
      await agentWorker.stop();
      fixture.database.close();
    }
  });

  it("requires approval between Agent image generation and model generation", async () => {
    const llm = new ImageThenModelLlmProvider();
    const fixture = await createFixture("image-model-approval", llm);
    const agentWorker = fixture.createAgentWorker("agent-worker-image-model");
    const imageWorker = fixture.createImageWorker();
    const modelProvider = new FakeModelProvider();
    const modelWorker = fixture.createModelWorker(modelProvider);
    try {
      const selectedModelProfile = fixture.providers.createProfile({
        id: "provider-model-selected",
        serviceType: "model",
        name: "Selected model provider",
        protocol: "openai-compatible",
        adapterType: "meshy",
        baseUrl: "https://selected-provider.example",
        apiKeyEnvironmentVariable: "LYRA_TEST_SELECTED_MODEL"
      });
      const selectedModel = fixture.providers.createModel(
        selectedModelProfile.id,
        {
          serviceType: "model",
          remoteModelId: "selected-meshy-6",
          displayName: "Selected Meshy",
          enabled: true,
          isDefault: false
        }
      );
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const submitted = fixture.agentService.sendMessage(conversation.id, {
        text: "先生成角色图片，再制作成 3D 模型",
        attachments: [],
        selection: {
          defaultImageProviderProfileId: fixture.seed.providerProfileId,
          defaultImageModelId: fixture.seed.imageModelId,
          defaultModelProviderProfileId: selectedModelProfile.id,
          defaultModelId: selectedModel.id
        }
      });
      expect(fixture.agentRuns.requireStored(submitted.agentRun.id)).toMatchObject({
        defaultImageProfileId: fixture.seed.providerProfileId,
        defaultImageModelId: fixture.seed.imageModelId,
        defaultModelProfileId: selectedModelProfile.id,
        defaultModelModelId: selectedModel.id
      });
      agentWorker.start();
      imageWorker.start();
      modelWorker.start();

      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "awaiting_user", 5_000);
      expect(
        fixture.jobs.list({ projectId: fixture.seed.projectId })
          .filter((job) => job.kind === "model.generate")
      ).toHaveLength(0);
      expect(modelProvider.submitCalls).toBe(0);

      fixture.agentService.submitUserInput(submitted.agentRun.id, {
        text: "批准并开始建模",
        choiceId: "approve",
        attachments: []
      });
      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "completed", 7_000);

      const imageJob = fixture.jobs.list({ projectId: fixture.seed.projectId })
        .find((job) => job.kind === "image.generate");
      const modelJob = fixture.jobs.list({ projectId: fixture.seed.projectId })
        .find((job) => job.kind === "model.generate");
      expect(imageJob).toMatchObject({ status: "succeeded" });
      expect(modelJob).toMatchObject({
        status: "succeeded",
        source: "agent",
        providerProfileId: selectedModelProfile.id,
        providerModelId: selectedModel.id,
        inputs: [
          {
            assetId: imageJob?.outputs[0]?.assetId,
            position: 1
          }
        ]
      });
      expect(modelProvider.submitCalls).toBe(1);
      expect(modelJob?.outputs).toHaveLength(1);
      expect(fixture.assets.getAsset(modelJob!.outputs[0]!.assetId)).toMatchObject({
        kind: "model",
        mimeType: "model/gltf-binary"
      });
      expect(fixture.conversations.listMessages(conversation.id).at(-1)?.text)
        .toBe("图片和模型均已生成，请验收。");
    } finally {
      await agentWorker.stop();
      await imageWorker.stop();
      await modelWorker.stop();
      fixture.database.close();
    }
  });

  it("restores a tool checkpoint after restart and executes multiple generic image calls", async () => {
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-image-1",
          name: "generate_image",
          arguments: { prompt: "先生成大致人物", count: 1 }
        }
      },
      {
        type: "tool_call",
        call: {
          id: "call-image-2",
          name: "generate_image",
          arguments: { prompt: "继续细化头部三视图", count: 1 }
        }
      },
      { type: "message", text: "两轮图片已经生成，请验收。" }
    ]);
    const fixture = await createFixture("restart", llm);
    const firstAgent = fixture.createAgentWorker("agent-worker-first");
    const secondAgent = fixture.createAgentWorker("agent-worker-second");
    const imageWorker = fixture.createImageWorker();
    try {
      const firstAsset = await fixture.assets.uploadImage({
        projectId: fixture.seed.projectId,
        originalName: "character.png",
        data: ONE_PIXEL_PNG
      });
      const secondAsset = await fixture.assets.uploadImage({
        projectId: fixture.seed.projectId,
        originalName: "pose.png",
        data: ONE_PIXEL_PNG
      });
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const submitted = fixture.agentService.sendMessage(conversation.id, {
        text: "  把图二的人物替换为图一，再逐步细化  ",
        attachments: [
          { assetId: firstAsset.id, position: 1, label: "图1" },
          { assetId: secondAsset.id, position: 2, label: "图2" }
        ]
      });

      firstAgent.start();
      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "waiting_tool");
      await firstAgent.stop();

      imageWorker.start();
      secondAgent.start();
      const completed = await waitForAgent(
        fixture.agentRuns,
        submitted.agentRun.id,
        "completed",
        5_000
      );
      expect(completed.toolCallCount).toBe(2);
      expect(fixture.imageProvider.requests).toHaveLength(2);
      expect(fixture.imageProvider.requests.map((request) => request.prompt)).toEqual([
        "先生成大致人物",
        "继续细化头部三视图"
      ]);
      expect(fixture.imageProvider.requests[0]?.attachments).toEqual([
        { assetId: firstAsset.id, position: 1, label: "图1" },
        { assetId: secondAsset.id, position: 2, label: "图2" }
      ]);
      expect(llm.inputs[0]?.messages.at(-1)).toMatchObject({
        content: "  把图二的人物替换为图一，再逐步细化  ",
        attachments: [
          { assetId: firstAsset.id, position: 1, label: "图1" },
          { assetId: secondAsset.id, position: 2, label: "图2" }
        ]
      });
      expect(
        fixture.database.connection.prepare("SELECT COUNT(*) AS count FROM jobs").get()
      ).toMatchObject({ count: 2 });

      const messages = fixture.conversations.listMessages(conversation.id);
      expect(messages.map((message) => message.text)).toEqual([
        "  把图二的人物替换为图一，再逐步细化  ",
        "两轮图片已经生成，请验收。"
      ]);
      expect(messages[0]?.attachments.map((attachment) => attachment.label)).toEqual([
        "图1",
        "图2"
      ]);
      const steps = fixture.agentSteps.list(submitted.agentRun.id);
      expect(steps.filter((step) => step.type === "tool_call")).toHaveLength(2);
      expect(steps.filter((step) => step.type === "tool_result")).toHaveLength(2);
      expect(steps.at(-1)).toMatchObject({ type: "final_message", status: "completed" });
      expect(llm.inputs[1]?.messages.at(-1)).toMatchObject({
        role: "tool",
        toolCallId: "call-image-1"
      });
      const publicEvents = fixture.events.list({ projectId: fixture.seed.projectId });
      expect(publicEvents.some((event) => event.type === "agent.waiting_tool")).toBe(true);
      expect(JSON.stringify(publicEvents)).not.toContain("checkpoint");
    } finally {
      await firstAgent.stop();
      await secondAgent.stop();
      await imageWorker.stop();
      fixture.database.close();
    }
  });

  it("persists a request_user_input checkpoint and resumes with the user's answer", async () => {
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-input-1",
          name: "request_user_input",
          arguments: {
            prompt: "需要保留哪张图的背景？",
            choices: [
              { id: "keep-first", label: "保留图一" },
              { id: "keep-second", label: "保留图二" }
            ]
          }
        }
      },
      { type: "message", text: "已记录：保留图二背景。" }
    ]);
    const fixture = await createFixture("user-input", llm);
    const worker = fixture.createAgentWorker("agent-worker-input");
    try {
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const submitted = fixture.agentService.sendMessage(conversation.id, {
        text: "帮我继续处理这张图",
        attachments: []
      });
      worker.start();
      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "awaiting_user");
      const resumed = fixture.agentService.submitUserInput(submitted.agentRun.id, {
        text: "保留图二背景",
        choiceId: "keep-second",
        attachments: []
      });
      expect(resumed.agentRun.status).toBe("resuming");
      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "completed");

      const steps = fixture.agentSteps.list(submitted.agentRun.id);
      expect(steps.some((step) => step.type === "user_input_request")).toBe(true);
      expect(steps.some((step) => step.type === "user_input_result")).toBe(true);
      expect(llm.inputs[1]?.messages.at(-1)?.content).toContain("keep-second");
      expect(fixture.conversations.listMessages(conversation.id).map((message) => message.text)).toEqual([
        "帮我继续处理这张图",
        "保留图二背景",
        "已记录：保留图二背景。"
      ]);
    } finally {
      await worker.stop();
      fixture.database.close();
    }
  });

  it("uses the exact user text when Agent image prompt optimization is disabled", async () => {
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-raw-prompt",
          name: "generate_image",
          arguments: {
            prompt: "为线稿添加自然和谐的色彩，保持构图和人物细节不变。",
            count: 1
          }
        }
      },
      { type: "message", text: "图片已生成。" }
    ]);
    const fixture = await createFixture("raw-prompt", llm);
    const agentWorker = fixture.createAgentWorker("agent-worker-raw-prompt");
    const imageWorker = fixture.createImageWorker();
    try {
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const submitted = fixture.agentService.sendMessage(conversation.id, {
        text: "为该图片上色",
        attachments: [],
        optimizeImagePrompt: false
      });
      expect(fixture.agentRuns.requireStored(submitted.agentRun.id).optimizeImagePrompt).toBe(false);

      agentWorker.start();
      imageWorker.start();
      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "completed");

      expect(fixture.imageProvider.requests).toHaveLength(1);
      expect(fixture.imageProvider.requests[0]?.prompt).toBe("为该图片上色");
      expect(fixture.jobs.list({ projectId: fixture.seed.projectId })[0]?.title).toBe("为该图片上色");
    } finally {
      await agentWorker.stop();
      await imageWorker.stop();
      fixture.database.close();
    }
  });

  it("does not offer image generation again after a failed image task", async () => {
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-failed-image",
          name: "generate_image",
          arguments: { prompt: "生成一只小猫", count: 1 }
        }
      },
      { type: "message", text: "本次图片生成失败，请检查供应商连接后重试。" }
    ]);
    const fixture = await createFixture("failed-image", llm, "provider failed");
    const agentWorker = fixture.createAgentWorker("agent-worker-failed-image");
    const imageWorker = fixture.createImageWorker();
    try {
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const submitted = fixture.agentService.sendMessage(conversation.id, {
        text: "生成一只小猫",
        attachments: []
      });
      agentWorker.start();
      imageWorker.start();
      await waitForAgent(fixture.agentRuns, submitted.agentRun.id, "completed");

      expect(fixture.imageProvider.requests).toHaveLength(1);
      expect(fixture.jobs.list({ projectId: fixture.seed.projectId })).toHaveLength(1);
      expect(llm.inputs[1]?.tools.map((tool) => tool.name)).not.toContain("generate_image");
      expect(llm.inputs[1]?.messages.at(-1)?.content).toContain('"retryAllowed":false');
    } finally {
      await agentWorker.stop();
      await imageWorker.stop();
      fixture.database.close();
    }
  });

  it("inherits source attachments when a new Agent message only asks to retry", async () => {
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-retry-source-1",
          name: "generate_image",
          arguments: { prompt: "first image", count: 1 }
        }
      },
      { type: "message", text: "first attempt failed" },
      {
        type: "tool_call",
        call: {
          id: "call-retry-source-2",
          name: "generate_image",
          arguments: { prompt: "retry image", count: 1 }
        }
      },
      { type: "message", text: "retry attempt failed" }
    ]);
    const fixture = await createFixture("retry-source", llm, "provider failed");
    const agentWorker = fixture.createAgentWorker("agent-worker-retry-source");
    const imageWorker = fixture.createImageWorker();
    try {
      const asset = await fixture.assets.uploadImage({
        projectId: fixture.seed.projectId,
        originalName: "source.png",
        data: ONE_PIXEL_PNG
      });
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const first = fixture.agentService.sendMessage(conversation.id, {
        text: "first request",
        attachments: [{ assetId: asset.id, position: 1, label: "图1" }]
      });
      agentWorker.start();
      imageWorker.start();
      await waitForAgent(fixture.agentRuns, first.agentRun.id, "completed");

      const retry = fixture.agentService.sendMessage(conversation.id, {
        text: "重试一下",
        attachments: []
      });
      await waitForAgent(fixture.agentRuns, retry.agentRun.id, "completed");

      const jobs = fixture.jobs.list({ projectId: fixture.seed.projectId });
      expect(jobs).toHaveLength(2);
      expect(jobs[1]?.inputs).toEqual([
        { assetId: asset.id, position: 1, label: "图1" }
      ]);
    } finally {
      await agentWorker.stop();
      await imageWorker.stop();
      fixture.database.close();
    }
  });

  it("records invalid tool arguments without creating an image job", async () => {
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-invalid",
          name: "generate_image",
          arguments: { count: 0 }
        }
      }
    ]);
    const fixture = await createFixture("invalid-tool", llm);
    const worker = fixture.createAgentWorker("agent-worker-invalid");
    try {
      const conversation = fixture.agentService.createConversation(fixture.seed.projectId);
      const submitted = fixture.agentService.sendMessage(conversation.id, {
        text: "生成图片",
        attachments: []
      });
      worker.start();
      const failed = await waitForAgentFailure(fixture.agentRuns, submitted.agentRun.id);
      expect(failed.errorCode).toBe("AGENT_EXECUTION_FAILED");
      expect(failed.errorMessage).toContain("Invalid arguments for agent tool generate_image");
      expect(fixture.agentSteps.list(submitted.agentRun.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_call", status: "failed" }),
          expect.objectContaining({ type: "tool_result", status: "failed" })
        ])
      );
      expect(
        fixture.database.connection.prepare("SELECT COUNT(*) AS count FROM jobs").get()
      ).toMatchObject({ count: 0 });
    } finally {
      await worker.stop();
      fixture.database.close();
    }
  });
});

async function createFixture(
  suffix: string,
  llm: LlmProvider,
  imageFailWith?: string
) {
  const directory = await mkdtemp(join(tmpdir(), `lyra-agent-${suffix}-`));
  temporaryDirectories.push(directory);
  const database = new LyraDatabase(join(directory, "database", "lyra.sqlite3"));
  const seed = prepareM4Database(database);
  const settings = new AppSettingsRepository(database);
  const promptSettings = new AgentPromptSettingsService(settings, {
    systemPrompt: "默认 Agent 系统提示词。",
    optimizeEnabledPrompt: "默认优化规则。",
    optimizeDisabledPrompt: "默认禁止优化规则。"
  });
  settings.set("default_llm_model_id", seed.llmModelId);
  settings.set("default_image_model_id", seed.imageModelId);
  const providers = new ProviderRepository(database);
  const modelProfile = providers.createProfile({
    id: `provider-model-${suffix}`,
    serviceType: "model",
    name: "Test model provider",
    protocol: "openai-compatible",
    adapterType: "meshy",
    baseUrl: "https://provider.example",
    apiKeyEnvironmentVariable: `LYRA_TEST_MODEL_${suffix.toUpperCase().replaceAll("-", "_")}`
  });
  const model = providers.createModel(modelProfile.id, {
    serviceType: "model",
    remoteModelId: "meshy-6",
    displayName: "Meshy test",
    enabled: true,
    isDefault: true
  });
  settings.set("default_model_provider_model_id", model.id);
  const events = new RuntimeEventRepository(database);
  const conversations = new ConversationRepository(database);
  const agentRuns = new AgentRunRepository(database, events);
  const agentSteps = new AgentStepRepository(database);
  const jobs = new JobRepository(database, events);
  const assetRepository = new AssetRepository(database);
  const assets = new AssetService({
    assets: assetRepository,
    blobs: new ImmutableBlobStore(join(directory, "blobs")),
    thumbnails: new ThumbnailStore(join(directory, "thumbnails")),
    images: new SharpImageProcessor()
  });
  const workers = new WorkerInstanceRepository(database);
  const generations = new QueuedGenerationService(jobs);
  const modelGenerations = new ModelGenerationService({
    projects: new ProjectRepository(database),
    assets: assetRepository,
    providers,
    jobs
  });
  const imageProvider = new FakeBinaryImageProvider({
    delayMs: 20,
    ...(imageFailWith ? { failWith: imageFailWith } : {})
  });
  const resolver: AgentLlmProviderResolver = { resolve: () => llm };
  const agentService = new AgentConversationService({
    database,
    conversations,
    agentRuns,
    agentSteps,
    providers,
    settings,
    assets: assetRepository,
    events
  });
  return {
    directory,
    database,
    seed,
    events,
    conversations,
    agentRuns,
    agentSteps,
    jobs,
    assets,
    workers,
    generations,
    modelGenerations,
    providers,
    settings,
    promptSettings,
    imageProvider,
    agentService,
    createAgentWorker(workerId: string) {
      return new AgentWorkerRuntime({
        database,
        agentRuns,
        agentSteps,
        jobs,
        conversations,
        runtimeEvents: events,
        workers,
        generations,
        modelGenerations,
        providers,
        settings,
        llmProviders: resolver,
        promptSettings,
        workerId,
        version: "test-v1",
        pollIntervalMs: 10,
        heartbeatIntervalMs: 20,
        cancellationPollIntervalMs: 10,
        staleLockTimeoutMs: 1_000,
        executionTimeoutMs: 3_000
      });
    },
    createImageWorker() {
      return new JobWorkerRuntime({
        jobs,
        workers,
        executor: new ImageJobExecutor({ provider: imageProvider, assets }),
        workerId: `image-worker-${suffix}`,
        version: "test-v1",
        pollIntervalMs: 10,
        heartbeatIntervalMs: 20,
        cancellationPollIntervalMs: 10,
        staleLockTimeoutMs: 1_000,
        executionTimeoutMs: 3_000
      });
    },
    createModelWorker(provider: BinaryModelProvider) {
      return new JobWorkerRuntime({
        jobs,
        workers,
        executor: new ModelJobExecutor({
          providerResolver: { resolve: () => provider },
          assets,
          jobs,
          pollIntervalMs: 250
        }),
        workerId: `model-worker-${suffix}`,
        version: "test-v1",
        kinds: ["model.generate"],
        workerKind: "model",
        pollIntervalMs: 10,
        heartbeatIntervalMs: 20,
        cancellationPollIntervalMs: 10,
        staleLockTimeoutMs: 1_000,
        executionTimeoutMs: 3_000
      });
    }
  };
}

function createMinimalGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    scenes: [{ nodes: [] }],
    scene: 0
  }));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const chunk = Buffer.alloc(paddedLength, 0x20);
  json.copy(chunk);
  const output = Buffer.alloc(12 + 8 + chunk.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(chunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(output, 20);
  return output;
}

async function waitForAgent(
  runs: AgentRunRepository,
  agentRunId: string,
  status: "waiting_tool" | "awaiting_user" | "completed",
  timeoutMs = 3_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = runs.requireStored(agentRunId);
    if (run.status === status) return run;
    if (run.status === "failed" || run.status === "interrupted" || run.status === "cancelled") {
      throw new Error(`Agent run reached ${run.status}: ${run.errorMessage ?? "no error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Agent run ${agentRunId} did not reach ${status}.`);
}

async function waitForAgentFailure(
  runs: AgentRunRepository,
  agentRunId: string,
  timeoutMs = 3_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = runs.requireStored(agentRunId);
    if (run.status === "failed") return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Agent run ${agentRunId} did not fail.`);
}
