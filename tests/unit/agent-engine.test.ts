import { describe, expect, it, vi } from "vitest";
import {
  AgentEngine,
  AgentToolCallLimitError,
  ToolRegistry,
  type AgentTool,
  type LlmProvider
} from "@lyra/agent-engine";

const completedTool: AgentTool = {
  definition: {
    name: "completed_tool",
    description: "Test tool",
    parameters: { type: "object", additionalProperties: false }
  },
  async execute() {
    return { status: "completed", content: "done" };
  }
};

const context = {
  projectId: "project-1",
  attachments: [],
  defaultImageProviderProfileId: "provider-1",
  defaultImageModelId: "model-1",
  metadata: {}
};

describe("AgentEngine", () => {
  it("stops accepting tool calls at the configured limit", async () => {
    const complete = vi.fn<LlmProvider["complete"]>().mockResolvedValue({
      type: "tool_call",
      call: { id: "call", name: "completed_tool", arguments: {} }
    });
    const engine = new AgentEngine({
      provider: { complete },
      tools: new ToolRegistry().register(completedTool),
      maxToolCalls: 1
    });

    await expect(
      engine.run({ messages: [{ role: "user", content: "run" }], context })
    ).rejects.toBeInstanceOf(AgentToolCallLimitError);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[0].tools).toHaveLength(1);
    expect(complete.mock.calls[1]?.[0].tools).toHaveLength(0);
  });

  it("passes cancellation to the LLM provider", async () => {
    const provider: LlmProvider = {
      complete({ signal }) {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason ?? new Error("Aborted."));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason ?? new Error("Aborted.")),
            { once: true }
          );
          void resolve;
        });
      }
    };
    const controller = new AbortController();
    const engine = new AgentEngine({ provider, tools: new ToolRegistry() });
    const running = engine.run(
      { messages: [{ role: "user", content: "run" }], context },
      controller.signal
    );

    controller.abort(new Error("cancelled"));
    await expect(running).rejects.toThrow("cancelled");
  });
});
