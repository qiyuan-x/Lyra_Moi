import type { AgentStepSnapshot } from "@lyra/contracts";

export type AgentTimelineItem =
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; step: AgentStepSnapshot; result?: AgentStepSnapshot }
  | { kind: "plan" | "input"; id: string; step: AgentStepSnapshot };

/** Keep each item at its original sequence, including after a tool finishes. */
export function buildAgentTimeline(steps: AgentStepSnapshot[], finalText?: string): AgentTimelineItem[] {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);
  const results = new Map<string, AgentStepSnapshot>();
  const callIds = new Set<string>();
  for (const step of ordered) {
    const id = step.payload.toolCallId;
    if (typeof id !== "string") continue;
    if (step.type === "tool_call") callIds.add(id);
    if (step.type === "tool_result") results.set(id, step);
  }
  const persistedFinal = [...ordered].reverse().find((step) => step.type === "final_message");
  const final = finalText || (typeof persistedFinal?.payload.text === "string" ? persistedFinal.payload.text : "");
  const lastResponse = [...ordered].reverse().find((step) => step.payload.kind === "progress" &&
    typeof step.payload.text === "string" && step.payload.text.trim());
  const finalPrefix = lastResponse?.status === "running" && final.startsWith(String(lastResponse.payload.text)) &&
    !ordered.some((step) => step.type === "tool_call" && step.sequence > lastResponse.sequence);
  const finalResponse = final && lastResponse &&
    (lastResponse.payload.final === true || lastResponse.payload.text === final || finalPrefix) ? lastResponse : undefined;
  const latestPlan = [...ordered].reverse().find((step) => step.payload.kind === "plan");
  const items: AgentTimelineItem[] = [];
  for (const step of ordered) {
    if (step.payload.kind === "progress" && typeof step.payload.text === "string" && step.payload.text.trim()) {
      items.push({ kind: "text", id: step.id, text: step === finalResponse ? final : step.payload.text,
        streaming: step.status === "running" && step !== finalResponse });
    } else if (step.type === "tool_call") {
      const result = results.get(String(step.payload.toolCallId));
      items.push({ kind: "tool", id: step.id, step, ...(result ? { result } : {}) });
    } else if (step.type === "tool_result" && !callIds.has(String(step.payload.toolCallId))) {
      items.push({ kind: "tool", id: step.id, step, result: step });
    } else if (step === latestPlan) {
      items.push({ kind: "plan", id: step.id, step });
    } else if (step.type === "user_input_request") {
      items.push({ kind: "input", id: step.id, step });
    }
  }
  // Older runs may only have a final message, without a matching progress step.
  if (final && !finalResponse) items.push({ kind: "text", id: persistedFinal?.id ?? "final", text: final, streaming: false });
  return items;
}
