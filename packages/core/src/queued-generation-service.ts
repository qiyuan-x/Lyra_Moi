import type { GenerationRequest, JobSnapshot } from "@lyra/contracts";
import type { JobRepository } from "@lyra/storage";
import { normalizeGenerationRequest } from "./generation-service.js";

export interface QueueGenerationOptions {
  conversationId?: string | null;
  agentRunId?: string | null;
  agentStepId?: string | null;
  requestMessageId?: string | null;
  title?: string;
}

export class QueuedGenerationService {
  readonly #jobs: JobRepository;

  constructor(jobs: JobRepository) {
    this.#jobs = jobs;
  }

  submit(request: GenerationRequest, options: QueueGenerationOptions = {}): JobSnapshot {
    const normalized = normalizeGenerationRequest(request);
    return this.#jobs.create({
      request: normalized,
      title: normalizeTitle(options.title ?? normalized.prompt),
      kind: "image.generate",
      conversationId: options.conversationId ?? null,
      agentRunId: options.agentRunId ?? null,
      agentStepId: options.agentStepId ?? null,
      requestMessageId: options.requestMessageId ?? null
    });
  }

  get(jobId: string): JobSnapshot {
    const job = this.#jobs.findById(jobId);
    if (!job) throw new Error(`Generation job not found: ${jobId}`);
    return job;
  }

  cancel(jobId: string): JobSnapshot {
    return this.#jobs.requestCancel(jobId);
  }

  retry(jobId: string): JobSnapshot {
    return this.#jobs.retry(jobId);
  }
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("Generation title is required.");
  return title.length <= 120 ? title : `${title.slice(0, 117)}...`;
}
