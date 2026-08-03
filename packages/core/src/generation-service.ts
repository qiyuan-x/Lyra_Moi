import { randomUUID } from "node:crypto";
import type {
  GeneratedAsset,
  GenerationRequest,
  GenerationTaskSnapshot
} from "@lyra/contracts";

export interface ImageProvider {
  generate(request: GenerationRequest, signal?: AbortSignal): Promise<GeneratedAsset[]>;
}

interface TaskRecord {
  snapshot: GenerationTaskSnapshot;
  completion: Promise<GenerationTaskSnapshot>;
}

export class GenerationService {
  readonly #provider: ImageProvider;
  readonly #tasks = new Map<string, TaskRecord>();

  constructor(provider: ImageProvider) {
    this.#provider = provider;
  }

  submit(request: GenerationRequest): GenerationTaskSnapshot {
    const normalized = normalizeGenerationRequest(request);
    const now = new Date().toISOString();
    const snapshot: GenerationTaskSnapshot = {
      id: randomUUID(),
      status: "queued",
      request: normalized,
      outputs: [],
      error: null,
      createdAt: now,
      updatedAt: now
    };

    const completion = Promise.resolve().then(() => this.#execute(snapshot));
    this.#tasks.set(snapshot.id, { snapshot, completion });
    return cloneSnapshot(snapshot);
  }

  get(taskId: string): GenerationTaskSnapshot {
    const task = this.#tasks.get(taskId);
    if (!task) throw new Error(`Generation task not found: ${taskId}`);
    return cloneSnapshot(task.snapshot);
  }

  async wait(taskId: string): Promise<GenerationTaskSnapshot> {
    const task = this.#tasks.get(taskId);
    if (!task) throw new Error(`Generation task not found: ${taskId}`);
    return cloneSnapshot(await task.completion);
  }

  async #execute(snapshot: GenerationTaskSnapshot): Promise<GenerationTaskSnapshot> {
    snapshot.status = "running";
    snapshot.updatedAt = new Date().toISOString();
    try {
      snapshot.outputs = await this.#provider.generate(snapshot.request);
      snapshot.status = "succeeded";
    } catch (error) {
      snapshot.status = "failed";
      snapshot.error = error instanceof Error ? error.message : String(error);
    }
    snapshot.updatedAt = new Date().toISOString();
    return snapshot;
  }
}

export function normalizeGenerationRequest(request: GenerationRequest): GenerationRequest {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error("Generation prompt is required.");
  if (!request.projectId.trim()) throw new Error("Project ID is required.");
  if (!request.providerProfileId.trim()) throw new Error("Provider profile ID is required.");
  if (!request.providerModelId.trim()) throw new Error("Provider model ID is required.");
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 8) {
    throw new Error("Generation count must be an integer between 1 and 8.");
  }

  const attachments = request.attachments.map((attachment) => ({ ...attachment }));
  for (const [index, attachment] of attachments.entries()) {
    const expectedPosition = index + 1;
    if (attachment.position !== expectedPosition) {
      throw new Error("Attachment positions must be continuous and start at 1.");
    }
    if (!attachment.assetId.trim() || !attachment.label.trim()) {
      throw new Error("Attachment asset ID and label are required.");
    }
  }

  return {
    ...request,
    prompt,
    attachments,
    parameters: structuredClone(request.parameters)
  };
}

function cloneSnapshot(snapshot: GenerationTaskSnapshot): GenerationTaskSnapshot {
  return structuredClone(snapshot);
}
