import type { Invocation, RunStore, RuntimeEvent, RuntimeState, ToolOutcome } from "@lyra/agent-runtime";
import type { AgentStepSnapshot } from "@lyra/contracts";
import type { LyraDatabase, RuntimeRepositories } from "@lyra/storage";

/** Versioned payloads use existing storage tables so downgrades do not change the app schema. */
export class AgentSessionStore implements RunStore {
  constructor(private readonly database: LyraDatabase, private readonly repositories: RuntimeRepositories,
    readonly runId: string, private readonly workerId: string) {}

  load(): RuntimeState | null {
    const step = this.checkpoint();
    if (!step) return null;
    const state = step.payload.checkpoint as RuntimeState;
    const run = this.repositories.agentRuns.requireStored(this.runId);
    if (state?.version !== 3 || state.runId !== this.runId || state.context?.projectId !== run.projectId ||
      state.context.conversationId !== run.conversationId || !Array.isArray(state.messages) || !Array.isArray(state.invocations)) {
      throw new Error("Agent 会话存档格式无效。");
    }
    return structuredClone(state);
  }

  async save(state: RuntimeState, event?: RuntimeEvent): Promise<void> {
    // Text deltas do not change the executable checkpoint or tool state.
    if (event?.type === "message.delta") {
      this.database.transaction(() => {
        this.assertOwner();
        this.publishProgress(state, event);
      });
      return;
    }
    const snapshot = structuredClone(state);
    this.database.transaction(() => {
      this.assertOwner();
      const { agentSteps, agentRuns, conversations, runtimeEvents } = this.repositories;
      const checkpoint = this.checkpoint();
      const payload = { runtimeCheckpoint: 3, checkpoint: snapshot };
      if (checkpoint) agentSteps.update(checkpoint.id, { payload });
      else agentSteps.append({ agentRunId: this.runId, type: "llm_request", status: "completed", payload });
      for (const item of snapshot.invocations) this.projectTool(item);
      if (event?.type === "turn.started") agentRuns.markThinking(this.runId, this.workerId);
      else if (snapshot.invocations.length && snapshot.calls) agentRuns.markCallingTool(this.runId, this.workerId, snapshot.calls);
      if (event) {
        if (event.type === "message.progress" || event.type === "run.completed") this.publishProgress(snapshot, event);
        if (event.type !== "message.progress") runtimeEvents.append({ projectId: snapshot.context.projectId, conversationId: snapshot.context.conversationId,
          agentRunId: this.runId, type: `agent.runtime.${event.type}`, payload: event.data });
        if (event.type === "plan.updated") agentSteps.append({ agentRunId: this.runId, type: "llm_response", status: "completed",
          payload: { kind: "plan", steps: snapshot.plan } });
      }
      if (snapshot.status === "waiting") {
        const item = snapshot.invocations.find((invocation) => invocation.status === "approval" || invocation.status === "input");
        if (item) {
          this.projectInput(item);
          agentRuns.releaseWaiting(this.runId, this.workerId, "awaiting_user");
        } else agentRuns.releaseWaiting(this.runId, this.workerId, "waiting_tool");
      } else if (snapshot.status === "completed") {
        const message = conversations.createMessage({ conversationId: snapshot.context.conversationId,
          role: "assistant", text: snapshot.finalText, replyToId: snapshot.context.requestMessageId });
        agentSteps.append({ agentRunId: this.runId, type: "final_message", status: "completed", payload: { messageId: message.id, text: snapshot.finalText } });
        runtimeEvents.append({ projectId: snapshot.context.projectId, conversationId: snapshot.context.conversationId,
          agentRunId: this.runId, type: "message.created", payload: { messageId: message.id, role: "assistant" } });
        agentRuns.complete(this.runId, this.workerId, { messageId: message.id });
      } else if (snapshot.status === "failed") {
        agentRuns.fail(this.runId, this.workerId, "AGENT_EXECUTION_FAILED", snapshot.error || "Agent 执行失败。");
      }
    });
  }

  private publishProgress(state: RuntimeState, event: RuntimeEvent): void {
    const { agentSteps, runtimeEvents } = this.repositories;
    const existing = agentSteps.findProgress(this.runId, state.turn);
    const text = event.type === "message.delta"
      ? String(existing?.payload.text ?? "") + String(event.data.text ?? "") : String(event.data.text ?? "");
    const payload = { kind: "progress", runtimeTurn: state.turn, text,
      revision: Number(existing?.payload.revision ?? 0) + 1, final: event.type === "run.completed" };
    const status = event.type === "message.delta" ? "running" : "completed";
    const step = existing ? agentSteps.update(existing.id, { payload, status }) :
      agentSteps.append({ agentRunId: this.runId, type: "llm_response", status, payload });
    // An absolute snapshot makes replay and reconnection idempotent.
    runtimeEvents.append({ projectId: state.context.projectId, conversationId: state.context.conversationId,
      agentRunId: this.runId, type: `agent.runtime.${event.type === "message.delta" ? "message.delta" : "message.progress"}`,
      payload: { step } });
  }

  /** Commit the business mutation and its result together. Replays return the recorded result. */
  perform(operationId: string, action: (stepId: string) => ToolOutcome): ToolOutcome {
    return this.database.transaction(() => {
      this.assertOwner();
      const step = this.repositories.agentSteps.findToolCall(this.runId, operationId);
      if (!step) throw new Error("工具执行记录未持久化。");
      if (step.payload.execution) return structuredClone(step.payload.execution) as ToolOutcome;
      const result = action(step.id);
      if (result instanceof Promise) throw new Error("Agent 原子操作不能包含异步副作用。");
      this.repositories.agentSteps.update(step.id, { payload: { ...step.payload, execution: result },
        ...(result.kind === "job" ? { childJobId: result.jobId } : {}) });
      return structuredClone(result);
    });
  }

  private checkpoint(): AgentStepSnapshot | undefined {
    return this.repositories.agentSteps.list(this.runId).find((step) => step.payload.runtimeCheckpoint === 3);
  }
  private assertOwner(): void {
    const run = this.repositories.agentRuns.requireStored(this.runId);
    if (run.lockedBy !== this.workerId || run.cancelRequested || !["thinking", "calling_tool", "resuming"].includes(run.status)) {
      throw new Error("Agent 已取消或执行锁已失效。");
    }
  }
  private projectTool(item: Invocation): void {
    const steps = this.repositories.agentSteps;
    const old = steps.findToolCall(this.runId, item.operationId);
    const status = item.status === "done" ? (item.error ? "failed" : "completed") :
      ["job", "approval", "input"].includes(item.status) ? "waiting" : item.status === "running" ? "running" : "pending";
    const payload = { ...old?.payload, toolCallId: item.operationId, modelCallId: item.call.id, arguments: item.arguments,
      ...(item.childRunId ? { childRunId: item.childRunId } : {}) };
    // Child runs are linked in the JSON payload, not child_job_id (which has a jobs FK).
    const step = old ? steps.update(old.id, { status, payload, childJobId: item.jobId ?? old.childJobId }) :
      steps.append({ agentRunId: this.runId, type: "tool_call", toolName: item.call.name, status, payload, childJobId: item.jobId ?? null });
    if (item.status === "done" && !step.payload.resultRecorded) {
      steps.append({ agentRunId: this.runId, type: "tool_result", toolName: item.call.name,
        status: item.error ? "failed" : "completed", childJobId: item.jobId ?? null,
        payload: { toolCallId: item.operationId, content: JSON.stringify(item.result ?? null), error: item.error ?? false } });
      steps.update(step.id, { payload: { ...step.payload, resultRecorded: true } });
    }
  }
  private projectInput(item: Invocation): void {
    const steps = this.repositories.agentSteps;
    if (steps.list(this.runId).some((step) => step.type === "user_input_request" && step.payload.operationId === item.operationId && step.status === "waiting")) return;
    const request = item.status === "approval" ? {
      prompt: `请审核 ${item.call.name} 的执行参数：\n${JSON.stringify(item.arguments, null, 2)}`,
      choices: [{ id: "approve", label: "批准执行" }, { id: "reject", label: "拒绝执行" }],
      metadata: { kind: "approval", operationId: item.operationId, hash: item.approvalHash, arguments: item.arguments }
    } : item.input!;
    steps.append({ agentRunId: this.runId, type: "user_input_request", status: "waiting", toolName: item.call.name,
      payload: { runtimeVersion: 3, operationId: item.operationId, toolCallId: item.operationId, approvalHash: item.approvalHash ?? null, request } });
  }
}
