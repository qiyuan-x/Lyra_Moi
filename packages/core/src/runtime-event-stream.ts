import type { RuntimeEventSnapshot } from "@lyra/contracts";
import type { RuntimeEventQuery, RuntimeEventRepository } from "@lyra/storage";

export interface RuntimeEventSubscription extends Omit<RuntimeEventQuery, "afterId" | "limit"> {
  afterId?: number;
  batchSize?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export class RuntimeEventFeed {
  readonly #events: RuntimeEventRepository;

  constructor(events: RuntimeEventRepository) {
    this.#events = events;
  }

  read(query: RuntimeEventQuery): RuntimeEventSnapshot[] {
    return this.#events.list(query);
  }

  async *subscribe(input: RuntimeEventSubscription): AsyncGenerator<RuntimeEventSnapshot> {
    const batchSize = input.batchSize ?? 100;
    const pollIntervalMs = input.pollIntervalMs ?? 250;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new Error("Runtime event batch size must be an integer between 1 and 500.");
    }
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60_000) {
      throw new Error("Runtime event poll interval must be between 10 and 60000 milliseconds.");
    }
    let afterId = input.afterId ?? 0;
    while (!input.signal?.aborted) {
      const events = this.#events.list({
        projectId: input.projectId,
        afterId,
        limit: batchSize,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        ...(input.agentRunId === undefined ? {} : { agentRunId: input.agentRunId }),
        ...(input.jobId === undefined ? {} : { jobId: input.jobId })
      });
      if (events.length === 0) {
        await abortableDelay(pollIntervalMs, input.signal);
        continue;
      }
      for (const event of events) {
        afterId = event.id;
        yield event;
      }
    }
  }
}

export function encodeServerSentEvent(event: RuntimeEventSnapshot): string {
  if (/\r|\n/u.test(event.type)) throw new Error("SSE event type cannot contain line breaks.");
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function encodeServerSentEventHeartbeat(): string {
  return `: heartbeat ${new Date().toISOString()}\n\n`;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
