import { describe, expect, it } from "vitest";
import { AgentToolValidationError, ToolRegistry } from "@lyra/agent-engine";
import { createGenerateImageTool } from "@lyra/agent-tools";
import { GenerationService } from "@lyra/core";
import { FakeImageProvider } from "@lyra/providers";

describe("ToolRegistry", () => {
  it("validates tool arguments before execution", async () => {
    const service = new GenerationService(new FakeImageProvider());
    const registry = new ToolRegistry().register(createGenerateImageTool(service));

    await expect(
      registry.execute(
        "generate_image",
        { count: 1 },
        {
          projectId: "project-1",
          attachments: [],
          defaultImageProviderProfileId: "provider-1",
          defaultImageModelId: "model-1",
          metadata: {}
        }
      )
    ).rejects.toBeInstanceOf(AgentToolValidationError);
  });
});
