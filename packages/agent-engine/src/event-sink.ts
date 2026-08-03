import type { AgentEvent, AgentEventSink } from "./types.js";

export class MemoryAgentEventSink implements AgentEventSink {
  readonly events: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.events.push(structuredClone(event));
  }
}

export const noOpAgentEventSink: AgentEventSink = {
  emit: () => undefined
};

