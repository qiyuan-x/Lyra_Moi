import { describe, expect, it } from "vitest";
import {
  defaultModelParameters,
  modelAdapterLabel,
  validateModelParameters
} from "../../apps/web/src/features/modeling/model-provider-config.js";

describe("model provider configuration", () => {
  it("provides separate defaults for supported adapters", () => {
    expect(defaultModelParameters("meshy", "meshy-t2")).toMatchObject({
      targetFaceCount: 4_000,
      topology: "triangle"
    });
    expect(defaultModelParameters("hunyuan", "hunyuan3d-2.1")).toMatchObject({
      targetFaceCount: 500_000,
      polygonType: "triangle"
    });
    expect(defaultModelParameters("tripo", "P1-500")).toMatchObject({
      targetFaceCount: 20_000,
      geometryQuality: "standard"
    });
  });

  it("validates provider-specific face count limits", () => {
    expect(validateModelParameters("meshy", "meshy-t2", {
      targetFaceCount: 15_001
    }, ["glb"])).toContain("15,000");
    expect(validateModelParameters("hunyuan", "hunyuan3d-2.1", {
      generateType: "Normal",
      targetFaceCount: 500_000
    }, ["glb"])).toBeNull();
    expect(validateModelParameters("tripo", "P1-500", {
      targetFaceCount: 20_000,
      geometryQuality: "standard"
    }, ["glb"])).toBeNull();
  });

  it("returns stable adapter labels", () => {
    expect(modelAdapterLabel("meshy")).toBe("Meshy");
    expect(modelAdapterLabel("hunyuan")).toBe("混元");
    expect(modelAdapterLabel("tripo")).toBe("Tripo");
  });
});
