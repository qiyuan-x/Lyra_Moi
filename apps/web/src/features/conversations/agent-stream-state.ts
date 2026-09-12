import type { AgentRunSnapshot, AgentStepSnapshot } from "@lyra/contracts";

export function isActiveAgentRun(run: AgentRunSnapshot): boolean {
  return !["completed", "failed", "cancelled", "interrupted"].includes(run.status);
}

/** Merge HTTP snapshots and SSE projections without duplicating or rewinding text. */
export function mergeAgentSteps(current: AgentStepSnapshot[], incoming: AgentStepSnapshot[]): AgentStepSnapshot[] {
  const steps = new Map(incoming.map((step) => [step.id, step]));
  for (const step of current) {
    const next = steps.get(step.id);
    if (step.payload.kind === "progress" && (!next || revision(step) > revision(next))) steps.set(step.id, step);
  }
  return [...steps.values()].sort((left, right) => left.sequence - right.sequence);
}

export function applyAgentProgress(
  current: Map<string, AgentStepSnapshot[]>, updates: AgentStepSnapshot[]
): Map<string, AgentStepSnapshot[]> {
  const next = new Map(current);
  for (const step of updates) {
    const previous = next.get(step.agentRunId) ?? [];
    next.set(step.agentRunId, mergeAgentSteps(previous, [
      ...previous.filter((item) => item.id !== step.id), step
    ]));
  }
  return next;
}

export function readAgentProgress(data: string, projectId: string, conversationId: string): AgentStepSnapshot | null {
  try {
    const event = JSON.parse(data);
    const step = event?.payload?.step;
    if (event.projectId !== projectId || event.conversationId !== conversationId || !step ||
        typeof step.id !== "string" || typeof step.agentRunId !== "string" || step.agentRunId !== event.agentRunId ||
        step.type !== "llm_response" || !Number.isInteger(step.sequence) ||
        !["running", "completed"].includes(step.status) || step.payload?.kind !== "progress" ||
        typeof step.payload.text !== "string" || !Number.isInteger(step.payload.revision)) return null;
    return step;
  } catch { return null; }
}

function revision(step: AgentStepSnapshot): number {
  return typeof step.payload.revision === "number" ? step.payload.revision : 0;
}
