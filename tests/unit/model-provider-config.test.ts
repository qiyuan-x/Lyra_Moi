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
      topology: "triangle",
      ultraMode: false
    });
    expect(defaultModelParameters("hunyuan", "hunyuan3d-2.1")).toMatchObject({
      targetFaceCount: 500_000,
      polygonType: "triangle"
    });
    expect(defaultModelParameters("tripo", "P1-500")).toMatchObject({
      targetFaceCount: 20_000,
      geometryQuality: "standard"
    });
    expect(defaultModelParameters("stability-3d", "spar3d")).toEqual({});
    expect(defaultModelParameters("openai-compatible", "meshy-7")).toMatchObject({
      targetFaceCount: 30_000,
      topology: "triangle",
      ultraMode: false
    });
    expect(defaultModelParameters("openai-compatible", "generic-3d")).toEqual({});
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
    expect(validateModelParameters("stability-3d", "spar3d", {}, ["glb"]))
      .toBeNull();
    expect(validateModelParameters("stability-3d", "spar3d", {}, ["obj"]))
      .toContain("GLB");
    expect(validateModelParameters("openai-compatible", "meshy-7", {
      targetFaceCount: 30_000
    }, ["glb", "obj"]))
      .toBeNull();
    expect(validateModelParameters("openai-compatible", "generic-3d", {}, ["obj"]))
      .toContain("GLB");
  });

  it("returns stable adapter labels", () => {
    expect(modelAdapterLabel("meshy")).toBe("Meshy");
    expect(modelAdapterLabel("hunyuan")).toBe("混元");
    expect(modelAdapterLabel("tripo")).toBe("Tripo");
    expect(modelAdapterLabel("stability-3d")).toBe("Stability AI");
    expect(modelAdapterLabel("openai-compatible")).toBe("OpenAI 兼容");
  });
});
