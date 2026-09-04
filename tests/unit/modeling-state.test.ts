import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPersistedModelingState,
  savePersistedModelingState
} from "../../apps/web/src/features/modeling/modeling-state.js";

describe("modeling page state", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists model and texture inputs independently", () => {
    savePersistedModelingState("project-1", {
      inputMode: "multiview",
      prompt: "",
      selectedImageId: "generated-model-image",
      selectedTextureImageId: "uploaded-texture-image",
      selectedMultiViewImageIds: {
        left: "left-image",
        back: "back-image"
      },
      modelConfigs: {}
    });

    expect(readPersistedModelingState("project-1")).toMatchObject({
      inputMode: "multiview",
      selectedImageId: "generated-model-image",
      selectedTextureImageId: "uploaded-texture-image",
      selectedMultiViewImageIds: {
        left: "left-image",
        back: "back-image"
      }
    });
  });

  it("migrates selections saved by the previous source-based state", () => {
    values.set("lyra.modeling.state.project-1", JSON.stringify({
      source: "generated",
      inputRole: "model",
      selectedImageBySource: {
        generated: "generated-model-image",
        upload: "uploaded-model-image"
      },
      selectedTextureImageBySource: {
        upload: "uploaded-texture-image"
      },
      modelConfigs: {}
    }));

    const restored = readPersistedModelingState("project-1");
    expect(restored.selectedImageId).toBe("generated-model-image");
    expect(restored.selectedTextureImageId).toBe("uploaded-texture-image");
  });
});
