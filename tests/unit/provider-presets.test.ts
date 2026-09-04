import { describe, expect, it } from "vitest";
import type { ProviderProfileSnapshot } from "@lyra/contracts";
import {
  adapterLabel,
  findPresetProfile,
  findProfilePreset,
  isStarterProviderProfile,
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

    const openAi = providerPresets.llm.find((preset) => preset.id === "openai")!;
    const deepSeekPreset = providerPresets.llm.find((preset) => preset.id === "deepseek")!;
    expect(findPresetProfile(openAi, [deepSeek])).toBeUndefined();
    expect(findPresetProfile(deepSeekPreset, [deepSeek])?.id)
      .toBe(deepSeek.id);
  });

  it("keeps preset identity after the user renames a provider", () => {
    const renamed = profile({
      name: "我的主要语言模型",
      settings: { __lyra: { providerKind: "deepseek" } },
      baseUrl: "https://gateway.example.com/v1"
    });

    expect(findProfilePreset(renamed)?.id).toBe("deepseek");
  });

  it("identifies starter profiles independently from provider identity", () => {
    expect(isStarterProviderProfile(profile({
      settings: { __lyra: { providerKind: "openai", starter: true } }
    }))).toBe(true);
    expect(isStarterProviderProfile(profile({
      settings: { __lyra: { providerKind: "openai" } }
    }))).toBe(false);
  });

  it("keeps generic OpenAI-compatible connections in the manual add flow", () => {
    expect(providerPresets.llm.some((preset) => preset.id === "openai-compatible"))
      .toBe(false);
    expect(providerPresets.image.some((preset) => preset.id === "image-openai-compatible"))
      .toBe(false);
  });

  it("provides FrostAPI presets for LLM, image, and 3D generation", () => {
    const llm = providerPresets.llm.find((preset) => preset.id === "frostapi");
    const image = providerPresets.image.find((preset) => preset.id === "frostapi");
    const model = providerPresets.model.find((preset) => preset.id === "frostapi");

    expect(llm).toMatchObject({
      name: "FrostAPI",
      protocol: "openai-compatible",
      adapterType: "openai-compatible",
      baseUrl: "https://api.linfrsot.cloud"
    });
    expect(image).toMatchObject({
      name: "FrostAPI 图像",
      protocol: "openai-compatible",
      adapterType: "openai-compatible",
      baseUrl: "https://api.linfrsot.cloud"
    });
    expect(model).toMatchObject({
      name: "FrostAPI 3D",
      protocol: "openai-compatible",
      adapterType: "frostapi-3d",
      baseUrl: "https://api.linfrsot.cloud",
      settings: {}
    });
  });

  it("uses current provider credential pages", () => {
    expect(providerPresets.llm.find((preset) => preset.id === "anthropic")?.apiKeyWebsite)
      .toBe("https://platform.claude.com/settings/keys");
    expect(providerPresets.llm.find((preset) => preset.id === "kimi")?.apiKeyWebsite)
      .toBe("https://platform.kimi.com/console/api-keys");
    expect(providerPresets.llm.find((preset) => preset.id === "qwen-llm")?.apiKeyWebsite)
      .toBe("https://bailian.console.aliyun.com/?tab=model");
    expect(providerPresets.llm.find((preset) => preset.id === "doubao")?.apiKeyWebsite)
      .toBe("https://console.volcengine.com/ark/region:ark+cn-beijing/apikey");
    expect(providerPresets.llm.find((preset) => preset.id === "xai")?.apiKeyWebsite)
      .toBe("https://console.x.ai/team/default/api-keys");
    expect(providerPresets.model.find((preset) => preset.id === "hunyuan")?.apiKeyWebsite)
      .toBe("https://console.cloud.tencent.com/tokenhub/apikey?regionId=1");
    expect(providerPresets.model.find((preset) => preset.id === "hunyuan")?.baseUrl)
      .toBe("https://tokenhub.tencentmaas.com");
    expect(providerPresets.model.find((preset) => preset.id === "tripo")?.apiKeyWebsite)
      .toBe("https://platform.tripo3d.ai/api-keys");
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
