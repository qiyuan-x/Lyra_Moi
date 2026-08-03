import type { AgentStepSnapshot, AgentStepStatus } from "@lyra/contracts";

export interface AgentToolStepStore {
  findToolCall(agentRunId: string, toolCallId: string): AgentStepSnapshot | null;
  findById(stepId: string): AgentStepSnapshot | null;
  list(agentRunId: string): AgentStepSnapshot[];
  update(
    stepId: string,
    input: {
      status?: AgentStepStatus;
      payload?: Record<string, unknown>;
      childJobId?: string | null;
    }
  ): AgentStepSnapshot;
}
