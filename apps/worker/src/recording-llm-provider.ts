import type { LlmCompletion, LlmCompletionInput, LlmProvider } from "@lyra/agent-engine";
import type { AgentStepRepository } from "@lyra/storage";

export class RecordingLlmProvider implements LlmProvider {
  readonly #agentRunId: string;
  readonly #delegate: LlmProvider;
  readonly #steps: AgentStepRepository;

  constructor(agentRunId: string, delegate: LlmProvider, steps: AgentStepRepository) {
    this.#agentRunId = agentRunId;
    this.#delegate = delegate;
    this.#steps = steps;
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    const requestStep = this.#steps.append({
      agentRunId: this.#agentRunId,
      type: "llm_request",
      status: "completed",
      payload: {
        messages: structuredClone(input.messages),
        tools: structuredClone(input.tools)
      }
    });
    try {
      const completion = await this.#delegate.complete(input);
      this.#steps.append({
        agentRunId: this.#agentRunId,
        type: "llm_response",
        status: "completed",
        payload: {
          requestStepId: requestStep.id,
          completion: structuredClone(completion)
        }
      });
      return completion;
    } catch (error) {
      this.#steps.append({
        agentRunId: this.#agentRunId,
        type: "llm_response",
        status: "failed",
        payload: {
          requestStepId: requestStep.id,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }
}
