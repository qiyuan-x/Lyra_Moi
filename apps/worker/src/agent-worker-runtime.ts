import { randomUUID } from "node:crypto";
import {
  AgentEngine,
  ToolRegistry,
  type AgentCheckpoint,
  type AgentMessage,
  type AgentToolCheckpoint,
  type AgentUserInputCheckpoint,
  type AgentUserInputResumeInput,
  type LlmProvider
} from "@lyra/agent-engine";
import {
  createQueuedGenerateImageTool,
  createQueuedGenerateModelTool,
  createRequestUserInputTool
} from "@lyra/agent-tools";
import {
  defaultOptimizeDisabledPrompt,
  defaultOptimizeEnabledPrompt,
  type AgentPromptSettingsService,
  type ModelGenerationService,
  type QueuedGenerationService
} from "@lyra/core";
import type { AgentPromptSettings } from "@lyra/contracts";
import type {
  AppSettingsRepository,
  AgentRunRepository,
  AgentStepRepository,
  ConversationRepository,
  JobRepository,
  LyraDatabase,
  ProviderRepository,
  RuntimeEventRepository,
  StoredAgentRun,
  WorkerInstanceRepository
} from "@lyra/storage";
import { ProviderConnectionError } from "@lyra/providers";
import { PersistentAgentEventSink } from "./persistent-agent-event-sink.js";
import { RecordingLlmProvider } from "./recording-llm-provider.js";

export interface AgentLlmProviderResolver {
  resolve(
    providerProfileId: string,
    providerModelId: string
  ): LlmProvider | Promise<LlmProvider>;
}

export interface AgentWorkerRuntimeOptions {
  database: LyraDatabase;
  agentRuns: AgentRunRepository;
  agentSteps: AgentStepRepository;
  jobs: JobRepository;
  conversations: ConversationRepository;
  runtimeEvents: RuntimeEventRepository;
  workers: WorkerInstanceRepository;
  generations: QueuedGenerationService;
  modelGenerations?: ModelGenerationService;
  providers?: ProviderRepository;
  settings?: AppSettingsRepository;
  llmProviders: AgentLlmProviderResolver;
  promptSettings?: Pick<AgentPromptSettingsService, "get">;
  systemPrompt?: string;
  workerId?: string;
  version: string;
  pid?: number | null;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  cancellationPollIntervalMs?: number;
  staleLockTimeoutMs?: number;
  executionTimeoutMs?: number;
}

class AgentWorkerStoppingError extends Error {
  constructor() {
    super("Agent worker is stopping.");
    this.name = "AgentWorkerStoppingError";
  }
}

class AgentCancellationError extends Error {
  constructor() {
    super("Agent cancellation was requested.");
    this.name = "AgentCancellationError";
  }
}

class AgentTimeoutError extends Error {
  constructor() {
    super("Agent run exceeded its execution timeout.");
    this.name = "AgentTimeoutError";
  }
}

export class AgentWorkerRuntime {
  readonly id: string;
  readonly #database: LyraDatabase;
  readonly #agentRuns: AgentRunRepository;
  readonly #agentSteps: AgentStepRepository;
  readonly #jobs: JobRepository;
  readonly #conversations: ConversationRepository;
  readonly #runtimeEvents: RuntimeEventRepository;
  readonly #workers: WorkerInstanceRepository;
  readonly #generations: QueuedGenerationService;
  readonly #modelGenerations: ModelGenerationService | null;
  readonly #providers: ProviderRepository | null;
  readonly #settings: AppSettingsRepository | null;
  readonly #llmProviders: AgentLlmProviderResolver;
  readonly #promptSettings: { get(): AgentPromptSettings };
  readonly #version: string;
  readonly #pid: number | null;
  readonly #pollIntervalMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #cancellationPollIntervalMs: number;
  readonly #staleLockTimeoutMs: number;
  readonly #executionTimeoutMs: number;
  #running = false;
  #stopping = false;
  #loopPromise: Promise<void> | null = null;
  #activeController: AbortController | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentWorkerRuntimeOptions) {
    this.id = options.workerId?.trim() || randomUUID();
    this.#database = options.database;
    this.#agentRuns = options.agentRuns;
    this.#agentSteps = options.agentSteps;
    this.#jobs = options.jobs;
    this.#conversations = options.conversations;
    this.#runtimeEvents = options.runtimeEvents;
    this.#workers = options.workers;
    this.#generations = options.generations;
    this.#modelGenerations = options.modelGenerations ?? null;
    this.#providers = options.providers ?? null;
    this.#settings = options.settings ?? null;
    this.#llmProviders = options.llmProviders;
    this.#promptSettings = options.promptSettings ?? createStaticPromptSettings(
      requireText(options.systemPrompt ?? "", "Agent system prompt")
    );
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
      options.executionTimeoutMs ?? 15 * 60_000,
      "executionTimeoutMs"
    );
  }

  get isRunning(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) throw new Error(`Agent worker ${this.id} is already running.`);
    this.#running = true;
    this.#stopping = false;
    this.#workers.register({ id: this.id, kind: "agent", version: this.#version, pid: this.#pid });
    this.#heartbeatTimer = setInterval(() => {
      try {
        this.#workers.heartbeat(this.id);
      } catch (error) {
        this.#activeController?.abort(error);
      }
    }, this.#heartbeatIntervalMs);
    this.#heartbeatTimer.unref();
    const cutoff = new Date(Date.now() - this.#staleLockTimeoutMs).toISOString();
    this.#agentRuns.recoverStale(cutoff);
    this.#loopPromise = this.#loop();
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#stopping = true;
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    this.#activeController?.abort(new AgentWorkerStoppingError());
    await this.#loopPromise;
    this.#agentRuns.interruptOwned(this.id);
    this.#workers.stop(this.id);
    this.#loopPromise = null;
    this.#running = false;
    this.#stopping = false;
  }

  async processNext(): Promise<boolean> {
    if (!this.#running) throw new Error(`Agent worker ${this.id} is not running.`);
    this.#queueCompletedToolRuns();
    const run = this.#agentRuns.claimNext(this.id);
    if (!run) return false;
    const controller = new AbortController();
    this.#activeController = controller;
    const heartbeat = setInterval(() => {
      try {
        this.#agentRuns.heartbeatLock(run.id, this.id);
      } catch (error) {
        controller.abort(error);
      }
    }, this.#heartbeatIntervalMs);
    heartbeat.unref();
    const cancellationPoll = setInterval(() => {
      try {
        if (this.#agentRuns.isCancellationRequested(run.id, this.id)) {
          controller.abort(new AgentCancellationError());
        }
      } catch (error) {
        controller.abort(error);
      }
    }, this.#cancellationPollIntervalMs);
    cancellationPoll.unref();
    const timeout = setTimeout(() => controller.abort(new AgentTimeoutError()), this.#executionTimeoutMs);
    timeout.unref();
    try {
      await this.#execute(run, controller.signal);
    } catch (error) {
      if (this.#stopping || error instanceof AgentWorkerStoppingError) return true;
      const current = this.#agentRuns.requireStored(run.id);
      if (current.lockedBy !== this.id) return true;
      if (
        error instanceof AgentCancellationError ||
        this.#agentRuns.isCancellationRequested(run.id, this.id)
      ) {
        this.#agentRuns.cancelClaimed(run.id, this.id);
      } else {
        this.#recordRunningToolFailure(run.id, error);
        const errorCode = error instanceof AgentTimeoutError
          ? "AGENT_TIMEOUT"
          : error instanceof ProviderConnectionError
            ? `AGENT_PROVIDER_${error.code}`
            : "AGENT_EXECUTION_FAILED";
        this.#agentRuns.fail(
          run.id,
          this.id,
          errorCode,
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancellationPoll);
      clearTimeout(timeout);
      this.#activeController = null;
    }
    return true;
  }

  async #execute(run: StoredAgentRun, signal: AbortSignal): Promise<void> {
    const resume = this.#findResumeInput(run);
    const defaultModel = run.defaultModelProfileId && run.defaultModelModelId
      ? {
          providerProfileId: run.defaultModelProfileId,
          id: run.defaultModelModelId
        }
      : this.#resolveDefaultModel();
    const provider = new RecordingLlmProvider(
      run.id,
      await this.#llmProviders.resolve(run.llmProviderProfileId, run.llmProviderModelId),
      this.#agentSteps
    );
    const tools = new ToolRegistry().register(createRequestUserInputTool());
    if (
      run.defaultImageProfileId
      && run.defaultImageModelId
      && !(resume?.type === "tool" && resume.preventImageRetry)
    ) {
      tools.register(createQueuedGenerateImageTool(this.#generations, this.#agentSteps));
    }
    if (this.#modelGenerations && defaultModel) {
      tools.register(createQueuedGenerateModelTool(this.#modelGenerations, this.#agentSteps));
    }
    const engine = new AgentEngine({
      provider,
      tools,
      maxToolCalls: run.maxToolCalls,
      eventSink: new PersistentAgentEventSink({
        database: this.#database,
        agentRunId: run.id,
        workerId: this.id,
        agentRuns: this.#agentRuns,
        agentSteps: this.#agentSteps,
        conversations: this.#conversations,
        runtimeEvents: this.#runtimeEvents
      })
    });
    if (resume?.type === "tool") {
      await engine.resume(resume.checkpoint, resume.result, signal);
      return;
    }
    if (resume?.type === "user") {
      await engine.resumeUserInput(resume.checkpoint, resume.input, signal);
      return;
    }

    const requestMessage = this.#conversations.findMessageById(run.requestMessageId);
    if (!requestMessage) throw new Error(`Agent request message not found: ${run.requestMessageId}`);
    const history = this.#conversations.listMessages(run.conversationId);
    const requestIndex = history.findIndex((message) => message.id === run.requestMessageId);
    if (requestIndex < 0) throw new Error(`Agent request message is not in its conversation.`);
    const requestAttachments = resolveAgentRequestAttachments(
      requestMessage,
      history,
      requestIndex
    );
    const promptSettings = this.#promptSettings.get();
    const messages: AgentMessage[] = [
      { role: "system", content: promptSettings.systemPrompt },
      {
        role: "system",
        content: run.optimizeImagePrompt
          ? promptSettings.optimizeEnabledPrompt
          : promptSettings.optimizeDisabledPrompt
      },
      ...history.slice(0, requestIndex + 1).map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content: message.text,
        attachments: structuredClone(message.attachments)
      } as AgentMessage))
    ];
    await engine.run(
      {
        runId: run.id,
        messages,
        context: {
          projectId: run.projectId,
          attachments: requestAttachments,
          metadata: {
            conversationId: run.conversationId,
            requestMessageId: run.requestMessageId,
            optimizeImagePrompt: run.optimizeImagePrompt,
            requestPrompt: requestMessage.text
          },
          ...(run.defaultImageProfileId
            ? { defaultImageProviderProfileId: run.defaultImageProfileId }
            : {}),
          ...(run.defaultImageModelId ? { defaultImageModelId: run.defaultImageModelId } : {}),
          ...(defaultModel
            ? {
                defaultModelProviderProfileId: defaultModel.providerProfileId,
                defaultModelId: defaultModel.id
              }
            : {})
        }
      },
      signal
    );
  }

  #findResumeInput(run: StoredAgentRun):
    | {
        type: "tool";
        checkpoint: AgentToolCheckpoint;
        result: { taskId: string; content: string };
        preventImageRetry: boolean;
      }
    | {
        type: "user";
        checkpoint: AgentUserInputCheckpoint;
        input: AgentUserInputResumeInput;
      }
    | null {
    if (run.status !== "resuming") return null;
    const steps = this.#agentSteps.list(run.id);
    const userResult = [...steps].reverse().find((step) => step.type === "user_input_result");
    const toolStep = [...steps]
      .reverse()
      .find((step) => step.type === "tool_call" && step.status === "waiting" && step.childJobId);
    if (userResult && (!toolStep || userResult.sequence > toolStep.sequence)) {
      const requestStepId = requirePayloadString(userResult.payload, "requestStepId");
      const requestStep = this.#agentSteps.findById(requestStepId);
      if (!requestStep) throw new Error(`Agent user input request step not found: ${requestStepId}`);
      return {
        type: "user",
        checkpoint: parseUserInputCheckpoint(requestStep.payload.checkpoint, run.id),
        input: parseUserInput(userResult.payload.input)
      };
    }
    if (!toolStep?.childJobId) throw new Error(`Agent resume checkpoint is missing: ${run.id}`);
    const job = this.#jobs.requireStored(toolStep.childJobId);
    if (!isTerminalJob(job.status)) throw new Error(`Agent child job is not complete: ${job.id}`);
    return {
      type: "tool",
      checkpoint: parseToolCheckpoint(toolStep.payload.checkpoint, run.id),
      result: {
        taskId: job.id,
        content: JSON.stringify({
          taskId: job.id,
          status: job.status,
          outputs: job.outputs,
          result: job.result,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          ...(job.status === "failed" || job.status === "cancelled" || job.status === "interrupted"
            ? {
                retryAllowed: false,
                instruction: `Report this result to the user. Do not call ${toolStep.toolName ?? "the same tool"} again in this run.`
              }
            : {})
        })
      },
      preventImageRetry: job.status !== "succeeded"
    };
  }

  #resolveDefaultModel(): { id: string; providerProfileId: string } | null {
    if (!this.#settings || !this.#providers) return null;
    const value = this.#settings.get("default_model_provider_model_id");
    if (typeof value !== "string" || !value) return null;
    const model = this.#providers.findModel(value);
    const profile = model ? this.#providers.findProfile(model.providerProfileId) : null;
    if (
      !model ||
      !profile ||
      model.serviceType !== "model" ||
      profile.serviceType !== "model" ||
      !model.enabled ||
      !profile.enabled
    ) {
      return null;
    }
    return { id: model.id, providerProfileId: profile.id };
  }

  #queueCompletedToolRuns(): void {
    for (const resumable of this.#agentSteps.listResumableTools()) {
      const run = this.#agentRuns.requireStored(resumable.step.agentRunId);
      if (run.status === "waiting_tool" && !run.cancelRequested) {
        this.#agentRuns.queueResume(run.id, "waiting_tool");
      }
    }
  }

  #recordRunningToolFailure(agentRunId: string, error: unknown): void {
    const toolStep = [...this.#agentSteps.list(agentRunId)]
      .reverse()
      .find((step) => step.type === "tool_call" && step.status === "running");
    if (!toolStep) return;
    const message = error instanceof Error ? error.message : String(error);
    this.#database.transaction(() => {
      this.#agentSteps.update(toolStep.id, { status: "failed" });
      this.#agentSteps.append({
        agentRunId,
        type: "tool_result",
        status: "failed",
        toolName: toolStep.toolName,
        payload: {
          toolCallId: toolStep.payload.toolCallId ?? null,
          error: message
        }
      });
    });
  }

  async #loop(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.processNext();
      if (!processed) await delay(this.#pollIntervalMs);
    }
  }
}

function createStaticPromptSettings(
  systemPrompt: string
): { get(): AgentPromptSettings } {
  const settings: AgentPromptSettings = {
    systemPrompt,
    optimizeEnabledPrompt: defaultOptimizeEnabledPrompt,
    optimizeDisabledPrompt: defaultOptimizeDisabledPrompt
  };
  return {
    get: () => structuredClone(settings)
  };
}

function parseToolCheckpoint(value: unknown, runId: string): AgentToolCheckpoint {
  const checkpoint = parseCheckpoint(value, runId);
  if (checkpoint.version !== 1 || !("pendingTool" in checkpoint)) {
    throw new Error(`Agent tool checkpoint is invalid: ${runId}`);
  }
  return checkpoint;
}

function parseUserInputCheckpoint(value: unknown, runId: string): AgentUserInputCheckpoint {
  const checkpoint = parseCheckpoint(value, runId);
  if (checkpoint.version !== 2 || !("pendingUserInput" in checkpoint)) {
    throw new Error(`Agent user input checkpoint is invalid: ${runId}`);
  }
  return checkpoint;
}

function parseCheckpoint(value: unknown, runId: string): AgentCheckpoint {
  if (!isRecord(value) || value.runId !== runId || (value.version !== 1 && value.version !== 2)) {
    throw new Error(`Agent checkpoint is invalid: ${runId}`);
  }
  return structuredClone(value) as unknown as AgentCheckpoint;
}

function parseUserInput(value: unknown): AgentUserInputResumeInput {
  if (!isRecord(value) || typeof value.text !== "string" || !Array.isArray(value.attachments)) {
    throw new Error("Stored Agent user input is invalid.");
  }
  return structuredClone(value) as unknown as AgentUserInputResumeInput;
}

function requirePayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value) throw new Error(`Agent step ${key} is required.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalJob(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
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

function resolveAgentRequestAttachments(
  requestMessage: {
    text: string;
    attachments: readonly { assetId: string; position: number; label: string }[];
  },
  history: readonly {
    role: string;
    attachments: readonly { assetId: string; position: number; label: string }[];
  }[],
  requestIndex: number
): { assetId: string; position: number; label: string }[] {
  if (requestMessage.attachments.length > 0 || !isRetryInstruction(requestMessage.text)) {
    return requestMessage.attachments.map((attachment) => ({ ...attachment }));
  }
  for (let index = requestIndex - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "user" && message.attachments.length > 0) {
      return message.attachments.map((attachment) => ({ ...attachment }));
    }
  }
  return [];
}

function isRetryInstruction(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 40 ||
    normalized.includes("不要") ||
    normalized.includes("不再")
  ) {
    return false;
  }
  return /(?:重试|再试|重新生成|重新尝试|再来一次|retry|try again)/iu.test(normalized);
}
