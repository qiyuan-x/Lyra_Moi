import { describe, expect, it } from "vitest";
import type {
  ProviderModelSnapshot,
  ProviderProfileSnapshot
} from "@lyra/contracts";
import type { ProviderCatalog } from "../../apps/web/src/lib/api-client.js";
import {
  findEnabledModel,
  geminiImageModelAlias,
  isDefaultServiceReady,
  listEnabledModels,
  providerModelDisplayName,
  providerModelLabel,
  providerSnapshotLabel
} from "../../apps/web/src/features/providers/catalog-selectors.js";

describe("provider catalog selectors", () => {
  const catalog: ProviderCatalog = {
    profiles: [
      profile("image-enabled", "image", true, "图片供应商"),
      profile("image-disabled", "image", false, "停用供应商"),
      profile("llm-enabled", "llm", true, "LLM 供应商")
    ],
    models: [
      model("image-ready", "image-enabled", "image", true),
      model("image-disabled-model", "image-enabled", "image", false),
      model("image-disabled-profile", "image-disabled", "image", true),
      model("llm-ready", "llm-enabled", "llm", true)
    ],
    defaults: {
      llm: "llm-ready",
      image: "image-ready",
      model: null
    }
  };

  it("returns only models whose model and provider are enabled", () => {
    expect(listEnabledModels(catalog, "image").map((item) => item.id))
      .toEqual(["image-ready"]);
  });

  it("checks readiness against the enabled default model", () => {
    expect(isDefaultServiceReady(catalog, "llm")).toBe(true);
    expect(isDefaultServiceReady({
      ...catalog,
      defaults: { ...catalog.defaults, image: "image-disabled-profile" }
    }, "image")).toBe(false);
  });

  it("does not return a model from a disabled provider", () => {
    expect(findEnabledModel(catalog, "image", "image-ready")?.id)
      .toBe("image-ready");
    expect(findEnabledModel(
      catalog,
      "image",
      "image-disabled-profile"
    )).toBeUndefined();
  });

  it("builds a stable provider and model label", () => {
    expect(providerModelLabel(catalog, catalog.models[0]!))
      .toBe("图片供应商 / image-ready");
  });

  it("adds the official Nano Banana alias to Gemini image models", () => {
    const gemini = {
      ...catalog.models[0]!,
      remoteModelId: "models/gemini-3.1-flash-image",
      displayName: "gemini-3.1-flash-image"
    };
    expect(providerModelDisplayName(gemini))
      .toBe("gemini-3.1-flash-image (Nano Banana 2)");
    expect(providerModelDisplayName({
      ...gemini,
      displayName: "Nano Banana 2"
    })).toBe("gemini-3.1-flash-image (Nano Banana 2)");
    expect(geminiImageModelAlias("gemini-3.1-flash-lite-image-preview"))
      .toBe("Nano Banana 2 Lite");
    expect(geminiImageModelAlias("gemini-3-pro-image"))
      .toBe("Nano Banana Pro");
    expect(geminiImageModelAlias("gemini-2.5-flash-image"))
      .toBe("Nano Banana");
    expect(providerSnapshotLabel("nanobana", "models/gemini-3.1-flash-image"))
      .toBe("nanobana / gemini-3.1-flash-image (Nano Banana 2)");
  });
});

function profile(
  id: string,
  serviceType: ProviderProfileSnapshot["serviceType"],
  enabled: boolean,
  name: string
): ProviderProfileSnapshot {
  return {
    id,
    serviceType,
    name,
    protocol: "openai-compatible",
    adapterType: "openai-compatible",
    baseUrl: "https://example.com/v1",
    apiKeyEnvironmentVariable: `${id}_KEY`,
    secondaryApiKeyEnvironmentVariable: null,
    hasApiKey: true,
    apiKeyMask: "••••",
    hasSecondaryApiKey: false,
    secondaryApiKeyMask: null,
    enabled,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function model(
  id: string,
  providerProfileId: string,
  serviceType: ProviderModelSnapshot["serviceType"],
  enabled: boolean
): ProviderModelSnapshot {
  return {
    id,
    providerProfileId,
    serviceType,
    remoteModelId: id,
    displayName: id,
    enabled,
    isDefault: false,
    capabilities: [],
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
