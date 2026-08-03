import type {
  ProviderAdapterType,
  ProviderModelSnapshot,
  ProviderProfileSnapshot,
  ProviderProtocol,
  ProviderServiceType
} from "@lyra/contracts";

export interface ProviderPreset {
  id: string;
  serviceType: ProviderServiceType;
  name: string;
  shortName: string;
  protocol: ProviderProtocol;
  adapterType: ProviderAdapterType;
  baseUrl: string;
  settings: Record<string, unknown>;
  aliases: string[];
  apiKeyWebsite?: string;
  apiKeyGuide?: string;
}

export const serviceSettings: Record<
  ProviderServiceType,
  { label: string; description: string }
> = {
  llm: { label: "LLM 设置", description: "配置 Agent 对话使用的语言模型。" },
  image: { label: "AI 生图设置", description: "配置手动模式和 Agent 工具使用的图片模型。" },
  model: { label: "AI 建模设置", description: "配置图片生成 3D 模型使用的供应商和模型。" }
};

export const protocolLabels: Record<ProviderProtocol, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI 兼容"
};

export const providerPresets: Record<ProviderServiceType, ProviderPreset[]> = {
  llm: [
    {
      id: "openai",
      serviceType: "llm",
      name: "ChatGPT",
      shortName: "GPT",
      protocol: "openai",
      adapterType: "openai",
      baseUrl: "https://api.openai.com/v1",
      settings: {},
      aliases: ["openai", "chatgpt"],
      apiKeyWebsite: "https://platform.openai.com/api-keys",
      apiKeyGuide: "1. 登录或注册 OpenAI Platform。\n2. 打开 API Keys 页面并点击 Create new secret key。\n3. 创建后立即复制密钥；完整密钥只显示一次。\n4. 确认账户已开通 API 计费后，再回到 Lyra 粘贴并测试。"
    },
    {
      id: "gemini",
      serviceType: "llm",
      name: "Gemini",
      shortName: "G",
      protocol: "gemini",
      adapterType: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      settings: {},
      aliases: ["gemini", "google"],
      apiKeyWebsite: "https://aistudio.google.com/app/apikey",
      apiKeyGuide: "1. 登录 Google AI Studio。\n2. 打开 Get API key，选择或创建 Google Cloud 项目。\n3. 点击 Create API key 创建密钥并复制保存。\n4. 确认 Gemini API 已启用，并检查配额后回到 Lyra 测试。"
    },
    {
      id: "deepseek",
      serviceType: "llm",
      name: "DeepSeek",
      shortName: "DS",
      protocol: "openai-compatible",
      adapterType: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      settings: {},
      aliases: ["deepseek"],
      apiKeyWebsite: "https://platform.deepseek.com/api_keys",
      apiKeyGuide: "1. 登录 DeepSeek 开放平台。\n2. 打开 API keys 页面并创建新密钥。\n3. 创建后立即复制密钥并妥善保存。\n4. 确认账户余额或充值状态，再回到 Lyra 粘贴并测试。"
    },
    {
      id: "openai-compatible",
      serviceType: "llm",
      name: "OpenAI 兼容",
      shortName: "API",
      protocol: "openai-compatible",
      adapterType: "openai-compatible",
      baseUrl: "",
      settings: {},
      aliases: ["openai compatible", "openai-compatible", "兼容"],
      apiKeyGuide: "请到当前 API 供应商的控制台创建密钥，并将供应商提供的 OpenAI 兼容 Base URL 一并填写。\n\n不同供应商的模型名称、计费和地区限制可能不同，建议先在供应商控制台确认接口可用。"
    }
  ],
  image: [
    {
      id: "gpt-image",
      serviceType: "image",
      name: "GPT",
      shortName: "GPT",
      protocol: "openai",
      adapterType: "openai",
      baseUrl: "https://api.openai.com/v1",
      settings: {},
      aliases: ["gpt", "openai"],
      apiKeyWebsite: "https://platform.openai.com/api-keys",
      apiKeyGuide: "1. 登录或注册 OpenAI Platform。\n2. 打开 API Keys 页面并点击 Create new secret key。\n3. 创建后立即复制密钥；完整密钥只显示一次。\n4. 确认账户已开通 API 计费后，再回到 Lyra 粘贴并测试。"
    },
    {
      id: "gemini-image",
      serviceType: "image",
      name: "Gemini",
      shortName: "G",
      protocol: "gemini",
      adapterType: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      settings: {},
      aliases: ["gemini", "google"],
      apiKeyWebsite: "https://aistudio.google.com/app/apikey",
      apiKeyGuide: "1. 登录 Google AI Studio。\n2. 打开 Get API key，选择或创建 Google Cloud 项目。\n3. 点击 Create API key 创建密钥并复制保存。\n4. 确认 Gemini API 已启用，并检查配额后回到 Lyra 测试。"
    },
    {
      id: "image-openai-compatible",
      serviceType: "image",
      name: "OpenAI 兼容",
      shortName: "API",
      protocol: "openai-compatible",
      adapterType: "openai-compatible",
      baseUrl: "",
      settings: {},
      aliases: ["openai compatible", "openai-compatible", "兼容"],
      apiKeyGuide: "请到当前 API 供应商的控制台创建密钥，并将供应商提供的 OpenAI 兼容 Base URL 一并填写。\n\n不同供应商的模型名称、计费和地区限制可能不同，建议先在供应商控制台确认接口可用。"
    }
  ],
  model: [
    {
      id: "meshy",
      serviceType: "model",
      name: "Meshy",
      shortName: "M",
      protocol: "openai-compatible",
      adapterType: "meshy",
      baseUrl: "https://api.meshy.ai",
      settings: {},
      aliases: ["meshy"],
      apiKeyWebsite: "https://www.meshy.ai/settings/api",
      apiKeyGuide: "1. 注册并登录 Meshy。\n2. 打开 API Settings 页面。\n3. 点击 Create API Key，填写名称并创建。\n4. 创建后立即复制密钥；Meshy 不会再次显示完整密钥。\n5. 回到 Lyra 粘贴密钥并执行连通性测试。"
    },
    {
      id: "hunyuan",
      serviceType: "model",
      name: "混元",
      shortName: "HY",
      protocol: "openai-compatible",
      adapterType: "hunyuan",
      baseUrl: "https://api.ai3d.cloud.tencent.com",
      settings: {},
      aliases: ["混元", "hunyuan"],
      apiKeyWebsite: "https://console.cloud.tencent.com/hunyuan",
      apiKeyGuide: "1. 登录腾讯云并完成实名认证。\n2. 在控制台开通混元生3D服务。\n3. 进入混元生3D的 API Key 管理或立即接入管理，创建 API Key。\n4. 复制并保存密钥；密钥通常只在创建时完整显示。\n5. Lyra 的 Base URL 使用 https://api.ai3d.cloud.tencent.com，粘贴 API Key 后测试。\n\n注意：混元生3D API Key 与腾讯云 SecretId/SecretKey 不是同一种凭证。如果控制台提示迁移到 TokenHub，请按腾讯云最新页面开通对应服务。"
    },
    {
      id: "tripo",
      serviceType: "model",
      name: "Tripo",
      shortName: "T",
      protocol: "openai-compatible",
      adapterType: "tripo",
      baseUrl: "https://api.tripo3d.ai/v2/openapi",
      settings: {},
      aliases: ["tripo"],
      apiKeyWebsite: "https://platform.tripo3d.ai",
      apiKeyGuide: "1. 注册并登录 Tripo Console。\n2. 打开 API Keys 页面。\n3. 创建新的 API Key 并立即复制保存；密钥只显示一次。\n4. 确认 API 账户已充值或有可用额度。\n5. 回到 Lyra 粘贴密钥并测试。\n\nTripo API Key 通常以 tsk_ 开头，不要把 Client ID（tcli_）当作 API Key。"
    }
  ]
};

export function countServiceModels(
  profileId: string,
  serviceType: ProviderServiceType,
  models: ProviderModelSnapshot[]
): number {
  return models.filter(
    (model) =>
      model.providerProfileId === profileId &&
      model.serviceType === serviceType
  ).length;
}

export function findPresetProfile(
  preset: ProviderPreset,
  profiles: ProviderProfileSnapshot[]
): ProviderProfileSnapshot | undefined {
  return profiles.find((profile) => {
    if (profile.serviceType !== preset.serviceType) return false;
    if (
      (preset.adapterType === "meshy" ||
        preset.adapterType === "hunyuan" ||
        preset.adapterType === "tripo") &&
      profile.adapterType === preset.adapterType
    ) return true;
    const name = profile.name.trim().toLowerCase();
    const baseUrl = profile.baseUrl.toLowerCase();
    if (preset.id === "deepseek") {
      return name.includes("deepseek") || baseUrl.includes("api.deepseek.com");
    }
    if (preset.protocol === "gemini") {
      return profile.protocol === "gemini" ||
        preset.aliases.some((alias) => name.includes(alias));
    }
    if (preset.id === "openai" || preset.id === "gpt-image") {
      const isDeepSeek =
        name.includes("deepseek") ||
        baseUrl.includes("api.deepseek.com");
      return !isDeepSeek &&
        (profile.protocol === "openai" ||
          preset.aliases.some((alias) => name === alias));
    }
    return preset.aliases.some((alias) => name.includes(alias));
  });
}

export function findProfilePreset(
  profile: ProviderProfileSnapshot
): ProviderPreset | null {
  return providerPresets[profile.serviceType]
    .find((preset) => findPresetProfile(preset, [profile])?.id === profile.id) ??
    null;
}

export function adapterLabel(adapterType: ProviderAdapterType): string {
  if (adapterType === "meshy") return "Meshy API";
  if (adapterType === "hunyuan") return "混元 API Key";
  if (adapterType === "tripo") return "Tripo API";
  return protocolLabels[adapterType];
}
