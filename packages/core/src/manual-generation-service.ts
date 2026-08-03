import type { JobSnapshot, ManualGenerationRequestBody } from "@lyra/contracts";
import { parseManualGenerationRequest } from "@lyra/contracts";
import type {
  AssetRepository,
  ConversationRepository,
  ProjectRepository,
  ProviderRepository
} from "@lyra/storage";
import type { QueuedGenerationService } from "./queued-generation-service.js";

export interface ManualGenerationServiceOptions {
  projects: ProjectRepository;
  conversations: ConversationRepository;
  assets: AssetRepository;
  providers: ProviderRepository;
  generations: QueuedGenerationService;
}

export class ManualGenerationService {
  readonly #projects: ProjectRepository;
  readonly #conversations: ConversationRepository;
  readonly #assets: AssetRepository;
  readonly #providers: ProviderRepository;
  readonly #generations: QueuedGenerationService;

  constructor(options: ManualGenerationServiceOptions) {
    this.#projects = options.projects;
    this.#conversations = options.conversations;
    this.#assets = options.assets;
    this.#providers = options.providers;
    this.#generations = options.generations;
  }

  submit(projectId: string, value: unknown): JobSnapshot {
    const normalizedProjectId = projectId.trim();
    const input = parseManualGenerationRequest({
      ...(isRecord(value) ? value : {}),
      projectId: normalizedProjectId
    });
    const project = this.#projects.findById(normalizedProjectId);
    if (!project || project.deletedAt !== null) throw new Error(`Project not found: ${projectId}`);
    if (input.conversationId) {
      const conversation = this.#conversations.requireById(input.conversationId);
      if (conversation.projectId !== input.projectId) {
        throw new Error("Conversation does not belong to the selected project.");
      }
    }
    this.#validateAttachments(input);
    this.#validateProvider(input);
    const { conversationId, ...generationInput } = input;
    return this.#generations.submit(
      { ...generationInput, source: "manual" },
      { title: input.prompt, conversationId: conversationId ?? null }
    );
  }

  #validateAttachments(input: ManualGenerationRequestBody): void {
    for (const attachment of input.attachments) {
      const asset = this.#assets.requireStored(attachment.assetId);
      if (asset.projectId !== input.projectId || asset.kind !== "image") {
        throw new Error(`Asset ${attachment.assetId} is not an image in project ${input.projectId}.`);
      }
    }
  }

  #validateProvider(input: ManualGenerationRequestBody): void {
    const profile = this.#providers.requireProfile(input.providerProfileId);
    const model = this.#providers.requireModel(input.providerModelId);
    if (
      !profile.enabled ||
      !model.enabled ||
      model.providerProfileId !== profile.id ||
      model.serviceType !== "image"
    ) {
      throw new Error("Selected image provider model is not available.");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
