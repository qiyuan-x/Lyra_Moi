import { describe, expect, it } from "vitest";
import type { ProviderProfileSnapshot } from "@lyra/contracts";
import {
  adapterLabel,
  findPresetProfile,
  findProfilePreset,
  providerPresets
} from "../../apps/web/src/features/settings/provider-presets.js";

describe("provider presets", () => {
  it("does not classify DeepSeek as the ChatGPT preset", () => {
    const deepSeek = profile({
      id: "deepseek-profile",
      name: "DeepSeek",
      protocol: "openai-compatible",
      adapterType: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1"
    });

    expect(findPresetProfile(providerPresets.llm[0]!, [deepSeek])).toBeUndefined();
    expect(findPresetProfile(providerPresets.llm[2]!, [deepSeek])?.id)
      .toBe(deepSeek.id);
  });

  it("matches model providers by adapter instead of display name", () => {
    const meshy = profile({
      id: "meshy-profile",
      serviceType: "model",
      name: "自定义名称",
      protocol: "openai-compatible",
      adapterType: "meshy",
      baseUrl: "https://api.meshy.ai"
    });

    expect(findProfilePreset(meshy)?.id).toBe("meshy");
    expect(adapterLabel(meshy.adapterType)).toBe("Meshy API");
  });
});

function profile(
  overrides: Partial<ProviderProfileSnapshot>
): ProviderProfileSnapshot {
  return {
    id: "profile",
    serviceType: "llm",
    name: "Provider",
    protocol: "openai-compatible",
    adapterType: "openai-compatible",
    baseUrl: "https://example.com/v1",
    apiKeyEnvironmentVariable: "TEST_API_KEY",
    secondaryApiKeyEnvironmentVariable: null,
    hasApiKey: true,
    apiKeyMask: "••••",
    hasSecondaryApiKey: false,
    secondaryApiKeyMask: null,
    enabled: true,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
