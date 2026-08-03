import { describe, expect, it } from "vitest";
import { GenerationService } from "@lyra/core";
import { FakeImageProvider } from "@lyra/providers";

describe("GenerationService", () => {
  it("returns a queued task before background execution", async () => {
    const service = new GenerationService(new FakeImageProvider({ delayMs: 5 }));
    const submitted = service.submit({
      projectId: "project-1",
      prompt: "test",
      attachments: [],
      providerProfileId: "provider-1",
      providerModelId: "model-1",
      count: 1,
      parameters: {},
      source: "manual"
    });

    expect(submitted.status).toBe("queued");
    expect((await service.wait(submitted.id)).status).toBe("succeeded");
  });

  it("rejects attachment arrays that do not preserve explicit order", () => {
    const service = new GenerationService(new FakeImageProvider());

    expect(() =>
      service.submit({
        projectId: "project-1",
        prompt: "test",
        attachments: [
          { assetId: "asset-2", label: "图2", position: 2 },
          { assetId: "asset-1", label: "图1", position: 1 }
        ],
        providerProfileId: "provider-1",
        providerModelId: "model-1",
        count: 1,
        parameters: {},
        source: "manual"
      })
    ).toThrow("Attachment positions must be continuous and start at 1.");
  });
});
