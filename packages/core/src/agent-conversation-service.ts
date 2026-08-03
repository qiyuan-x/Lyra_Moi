import type {
  AgentRunSnapshot,
  ConversationSnapshot,
  MessageSnapshot,
  ProviderModelSnapshot,
  ProviderServiceType,
  ResumeAgentUserInputRequestBody
} from "@lyra/contracts";
import {
  parseResumeAgentUserInputRequest,
  parseSendAgentMessageRequest
} from "@lyra/contracts";
import type {
  AgentRunRepository,
  AgentStepRepository,
  AppSettingsRepository,
  AssetRepository,
  ConversationRepository,
  LyraDatabase,
  ProviderRepository,
  RuntimeEventRepository
} from "@lyra/storage";

const DEFAULT_MODEL_KEYS: Record<"llm" | "image", string> = {
  llm: "default_llm_model_id",
  image: "default_image_model_id"
};

export interface AgentConversationServiceOptions {
  database: LyraDatabase;
  conversations: ConversationRepository;
  agentRuns: AgentRunRepository;
  agentSteps: AgentStepRepository;
  providers: ProviderRepository;
  settings: AppSettingsRepository;
  assets: AssetRepository;
  events: RuntimeEventRepository;
  systemPromptVersion?: string;
}

export interface SendAgentMessageResult {
  message: MessageSnapshot;
  agentRun: AgentRunSnapshot;
}

export class AgentConversationService {
  readonly #database: LyraDatabase;
  readonly #conversations: ConversationRepository;
  readonly #agentRuns: AgentRunRepository;
  readonly #agentSteps: AgentStepRepository;
  readonly #providers: ProviderRepository;
  readonly #settings: AppSettingsRepository;
  readonly #assets: AssetRepository;
  readonly #events: RuntimeEventRepository;
  readonly #systemPromptVersion: string;

  constructor(options: AgentConversationServiceOptions) {
    this.#database = options.database;
    this.#conversations = options.conversations;
    this.#agentRuns = options.agentRuns;
    this.#agentSteps = options.agentSteps;
    this.#providers = options.providers;
    this.#settings = options.settings;
    this.#assets = options.assets;
    this.#events = options.events;
    this.#systemPromptVersion = options.systemPromptVersion ?? "lyra-agent-v1";
  }

  createConversation(projectId: string, title = ""): ConversationSnapshot {
    return this.#conversations.create(projectId, title);
  }

  listConversations(projectId: string): ConversationSnapshot[] {
    return this.#conversations.list(projectId);
  }

  updateConversationTitle(conversationId: string, title: string): ConversationSnapshot {
    return this.#conversations.updateTitle(conversationId, title);
  }

  deleteConversation(conversationId: string): ConversationSnapshot {
    const activeRun = this.#agentRuns.listByConversation(conversationId)
      .find((run) => !["completed", "failed", "cancelled", "interrupted"].includes(run.status));
    if (activeRun) throw new Error("Cannot delete a conversation while its Agent is running.");
    return this.#conversations.softDelete(conversationId);
  }

  listMessages(conversationId: string): MessageSnapshot[] {
    return this.#conversations.listMessages(conversationId);
  }

  sendMessage(conversationId: string, value: unknown): SendAgentMessageResult {
    const input = parseSendAgentMessageRequest(value);
    const conversation = this.#conversations.requireById(conversationId);
    this.#validateAttachments(conversation.projectId, input.attachments);
    const llm = input.selection?.llmModelId
      ? this.#requireSelectedModel(
          input.selection.llmProviderProfileId!,
          input.selection.llmModelId,
          "llm"
        )
      : this.#requireDefaultModel("llm");
    const image = input.selection?.defaultImageModelId
      ? this.#requireSelectedModel(
          input.selection.defaultImageProviderProfileId!,
          input.selection.defaultImageModelId,
          "image"
        )
      : this.#findDefaultModel("image");
    const maxToolCallsSetting = this.#settings.get("agent_max_tool_calls");
    const maxToolCalls =
      typeof maxToolCallsSetting === "number" &&
      Number.isInteger(maxToolCallsSetting) &&
      maxToolCallsSetting >= 1 &&
      maxToolCallsSetting <= 100
        ? maxToolCallsSetting
        : 10;

    return this.#database.transaction(() => {
      const message = this.#conversations.createMessage({
        conversationId,
        role: "user",
        text: input.text,
        attachments: input.attachments
      });
      if (!conversation.title) {
        this.#conversations.updateTitle(conversationId, createConversationTitle(input.text));
      }
      this.#events.append({
        projectId: conversation.projectId,
        conversationId,
        agentRunId: null,
        jobId: null,
        type: "message.created",
        payload: { messageId: message.id, role: "user" },
        createdAt: message.createdAt
      });
      const agentRun = this.#agentRuns.create({
        projectId: conversation.projectId,
        conversationId,
        requestMessageId: message.id,
        llmProviderProfileId: llm.providerProfileId,
        llmProviderModelId: llm.id,
        defaultImageProfileId: image?.providerProfileId ?? null,
        defaultImageModelId: image?.id ?? null,
        optimizeImagePrompt: input.optimizeImagePrompt ?? true,
        systemPromptVersion: this.#systemPromptVersion,
        maxToolCalls
      });
      return { message, agentRun };
    });
  }

  submitUserInput(agentRunId: string, value: unknown): SendAgentMessageResult {
    const input = parseResumeAgentUserInputRequest(value);
    const run = this.#agentRuns.requireStored(agentRunId);
    if (run.status !== "awaiting_user") {
      throw new Error(`Agent run ${agentRunId} is not awaiting user input.`);
    }
    this.#validateAttachments(run.projectId, input.attachments);
    const requestStep = this.#agentSteps.findWaitingUserInput(agentRunId);
    if (!requestStep) throw new Error(`Agent user input request is missing: ${agentRunId}`);
    validateChoice(input, requestStep.payload);

    return this.#database.transaction(() => {
      const message = this.#conversations.createMessage({
        conversationId: run.conversationId,
        role: "user",
        text: input.text,
        attachments: input.attachments
      });
      this.#agentSteps.update(requestStep.id, { status: "completed" });
      this.#agentSteps.append({
        agentRunId,
        type: "user_input_result",
        status: "completed",
        toolName: requestStep.toolName,
        payload: {
          requestStepId: requestStep.id,
          messageId: message.id,
          input: structuredClone(input)
        }
      });
      this.#events.append({
        projectId: run.projectId,
        conversationId: run.conversationId,
        agentRunId,
        jobId: null,
        type: "message.created",
        payload: { messageId: message.id, role: "user", resumedAgent: true },
        createdAt: message.createdAt
      });
      const agentRun = this.#agentRuns.queueResume(agentRunId, "awaiting_user");
      return { message, agentRun };
    });
  }

  #validateAttachments(projectId: string, attachments: readonly { assetId: string }[]): void {
    for (const attachment of attachments) {
      const asset = this.#assets.requireStored(attachment.assetId);
      if (asset.projectId !== projectId) {
        throw new Error(`Asset ${asset.id} does not belong to project ${projectId}.`);
      }
    }
  }

  #requireSelectedModel(
    profileId: string,
    modelId: string,
    serviceType: ProviderServiceType
  ): ProviderModelSnapshot {
    const model = this.#providers.requireModel(modelId);
    const profile = this.#providers.requireProfile(profileId);
    if (
      model.providerProfileId !== profile.id ||
      model.serviceType !== serviceType ||
      !model.enabled ||
      !profile.enabled
    ) {
      throw new Error(`Selected ${serviceType} provider model is not available.`);
    }
    return model;
  }

  #requireDefaultModel(serviceType: "llm" | "image"): ProviderModelSnapshot {
    const model = this.#findDefaultModel(serviceType);
    if (!model) throw new Error(`Default ${serviceType} provider model is not configured.`);
    return model;
  }

  #findDefaultModel(serviceType: "llm" | "image"): ProviderModelSnapshot | null {
    const modelId = this.#settings.get(DEFAULT_MODEL_KEYS[serviceType]);
    if (typeof modelId !== "string" || !modelId) return null;
    const model = this.#providers.findModel(modelId);
    const profile = model ? this.#providers.findProfile(model.providerProfileId) : null;
    if (!model || !profile || model.serviceType !== serviceType || !model.enabled || !profile.enabled) {
      return null;
    }
    return model;
  }
}

function createConversationTitle(text: string): string {
  const title = text.trim().replace(/\s+/gu, " ");
  return title.length <= 60 ? title : `${title.slice(0, 57)}...`;
}

function validateChoice(
  input: ResumeAgentUserInputRequestBody,
  payload: Record<string, unknown>
): void {
  if (!input.choiceId) return;
  const request = payload.request;
  if (!isRecord(request) || !Array.isArray(request.choices)) {
    throw new Error("Agent user input request choices are invalid.");
  }
  const found = request.choices.some(
    (choice) => isRecord(choice) && choice.id === input.choiceId
  );
  if (!found) throw new Error("Agent user input choice is invalid.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
