import { describe, expect, it } from "vitest";
import { resolveModelGenerationAdapter } from "@lyra/contracts";

describe("model generation adapter resolution", () => {
  it("keeps direct provider adapters independent", () => {
    expect(resolveModelGenerationAdapter("meshy", "custom-model")).toBe("meshy");
    expect(resolveModelGenerationAdapter("tripo", "custom-model")).toBe("tripo");
    expect(resolveModelGenerationAdapter("hunyuan", "custom-model")).toBe("hunyuan");
    expect(resolveModelGenerationAdapter("stability-3d", "custom-model"))
      .toBe("stability-3d");
  });

  it("maps FrostAPI models to their official parameter adapter", () => {
    expect(resolveModelGenerationAdapter("frostapi-3d", "meshy-7")).toBe("meshy");
    expect(resolveModelGenerationAdapter("frostapi-3d", "v3.1-20260211")).toBe("tripo");
    expect(resolveModelGenerationAdapter("frostapi-3d", "P1-20260311")).toBe("tripo");
    expect(resolveModelGenerationAdapter("frostapi-3d", "3.1")).toBe("hunyuan");
    expect(resolveModelGenerationAdapter("frostapi-3d", "hy-3d-3.1")).toBe("hunyuan");
    expect(resolveModelGenerationAdapter("frostapi-3d", "unknown-3d")).toBeNull();
  });

  it("does not treat an OpenAI-compatible connection as a 3D provider", () => {
    expect(resolveModelGenerationAdapter("openai-compatible", "meshy-7")).toBeNull();
  });
});
