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
  credentialMode?: "single" | "pair";
  apiKeyWebsite?: string;
  apiKeyGuide?: string;
}

export const serviceSettings: Record<
  ProviderServiceType,
  { label: string; description: string }
> = {
  llm: {
    label: "LLM 设置",
    description: "配置对话智能体使用的语言模型。可同时启用多个供应商，并指定默认供应商和模型。"
  },
  image: {
    label: "AI 生图设置",
    description: "配置图片生成页面和对话智能体使用的图片模型。"
  },
  model: {
    label: "AI 建模设置",
    description: "配置文字或图片生成 3D 模型使用的供应商和模型。"
  }
};

export const protocolLabels: Record<ProviderProtocol, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  "openai-compatible": "OpenAI 兼容"
};

const OPENAI_GUIDE =
  "1. 登录 OpenAI Platform。\n2. 打开 API Keys 页面并创建密钥。\n3. 复制密钥后返回 Lyra 执行连通性测试。";
const GEMINI_GUIDE =
  "1. 登录 Google AI Studio。\n2. 打开 Get API key 并创建密钥。\n3. 确认 Gemini API 可用后返回 Lyra 执行连通性测试。";

export const providerPresets: Record<ProviderServiceType, ProviderPreset[]> = {
  llm: [
    preset("openai", "llm", "OpenAI", "GPT", "openai", "openai", "https://api.openai.com/v1", ["openai", "chatgpt"], "https://platform.openai.com/api-keys", OPENAI_GUIDE),
    preset("anthropic", "llm", "Claude", "C", "anthropic", "anthropic", "https://api.anthropic.com/v1", ["anthropic", "claude"], "https://console.anthropic.com/settings/keys", "1. 登录 Anthropic Console。\n2. 在 API Keys 页面创建密钥。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("gemini", "llm", "Gemini", "G", "gemini", "gemini", "https://generativelanguage.googleapis.com/v1beta", ["gemini", "google"], "https://aistudio.google.com/app/apikey", GEMINI_GUIDE),
    preset("deepseek", "llm", "DeepSeek", "DS", "openai-compatible", "openai-compatible", "https://api.deepseek.com/v1", ["deepseek"], "https://platform.deepseek.com/api_keys", "1. 登录 DeepSeek 开放平台。\n2. 在 API Keys 页面创建密钥。\n3. 确认账户可用后返回 Lyra 执行连通性测试。"),
    preset("frostapi", "llm", "FrostAPI", "Frost", "openai-compatible", "openai-compatible", "https://api.linfrsot.cloud", ["frostapi", "frost", "frsotapi"], "https://api.linfrsot.cloud", "1. 在 FrostAPI 控制台创建 API Key。\n2. 复制密钥后返回 Lyra。\n3. 使用默认端点执行连通性测试。"),
    preset("qwen-llm", "llm", "通义千问", "QW", "openai-compatible", "openai-compatible", "https://dashscope.aliyuncs.com/compatible-mode/v1", ["qwen", "通义", "千问", "dashscope"], "https://bailian.console.aliyun.com/", "1. 登录阿里云百炼控制台。\n2. 开通模型服务并创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("doubao", "llm", "豆包", "DB", "openai-compatible", "openai-compatible", "https://ark.cn-beijing.volces.com/api/v3", ["doubao", "豆包", "ark", "火山"], "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey", "1. 登录火山方舟控制台。\n2. 开通模型并创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("zhipu-llm", "llm", "智谱 GLM", "GLM", "openai-compatible", "openai-compatible", "https://open.bigmodel.cn/api/paas/v4", ["zhipu", "智谱", "glm", "bigmodel"], "https://open.bigmodel.cn/usercenter/apikeys", "1. 登录智谱开放平台。\n2. 在 API Keys 页面创建密钥。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("kimi", "llm", "Kimi", "K", "openai-compatible", "openai-compatible", "https://api.moonshot.cn/v1", ["kimi", "moonshot", "月之暗面"], "https://platform.moonshot.cn/console/api-keys", "1. 登录 Moonshot 开放平台。\n2. 创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("xai", "llm", "xAI", "xAI", "openai-compatible", "openai-compatible", "https://api.x.ai/v1", ["xai", "grok"], "https://console.x.ai/", "1. 登录 xAI Console。\n2. 创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("mistral", "llm", "Mistral", "M", "openai-compatible", "openai-compatible", "https://api.mistral.ai/v1", ["mistral"], "https://console.mistral.ai/api-keys", "1. 登录 Mistral Console。\n2. 创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。")
  ],
  image: [
    preset("gpt-image", "image", "OpenAI 图像", "GPT", "openai", "openai", "https://api.openai.com/v1", ["openai", "gpt-image", "chatgpt"], "https://platform.openai.com/api-keys", OPENAI_GUIDE),
    preset("frostapi", "image", "FrostAPI 图像", "Frost", "openai-compatible", "openai-compatible", "https://api.linfrsot.cloud", ["frostapi", "frost", "frsotapi"], "https://api.linfrsot.cloud", "1. 在 FrostAPI 控制台创建 API Key。\n2. 确认已开通图像模型。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("gemini-image", "image", "Gemini 图像", "G", "gemini", "gemini", "https://generativelanguage.googleapis.com/v1beta", ["gemini", "google"], "https://aistudio.google.com/app/apikey", GEMINI_GUIDE),
    preset("qwen-image", "image", "通义万相", "QW", "openai-compatible", "dashscope-image", "https://dashscope.aliyuncs.com/api/v1", ["qwen", "通义万相", "wan", "dashscope"], "https://bailian.console.aliyun.com/", "1. 登录阿里云百炼控制台。\n2. 开通通义万相或 Qwen-Image 并创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("seedream-image", "image", "即梦 Seedream", "SD", "openai-compatible", "seedream-image", "https://ark.cn-beijing.volces.com/api/v3", ["seedream", "即梦", "豆包", "ark"], "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey", "1. 登录火山方舟控制台。\n2. 开通 Seedream 模型并创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("zhipu-image", "image", "智谱 GLM-Image", "GLM", "openai-compatible", "zhipu-image", "https://open.bigmodel.cn/api/paas/v4", ["zhipu", "智谱", "glm-image", "cogview"], "https://open.bigmodel.cn/usercenter/apikeys", "1. 登录智谱开放平台。\n2. 创建 API Key 并开通图像模型。\n3. 返回 Lyra 执行连通性测试。"),
    {
      ...preset("hunyuan-image", "image", "腾讯混元生图", "HY", "openai-compatible", "hunyuan-image", "https://hunyuan.tencentcloudapi.com", ["hunyuan-image", "混元生图", "腾讯云"], "https://console.cloud.tencent.com/cam/capi", "1. 登录腾讯云控制台。\n2. 在访问管理的 API 密钥管理中创建 SecretId 和 SecretKey。\n3. 开通混元生图服务后，将两项凭证分别填入 Lyra。"),
      credentialMode: "pair"
    },
    preset("stability-image", "image", "Stability AI", "S", "openai-compatible", "stability-image", "https://api.stability.ai", ["stability", "stable image", "sd3"], "https://platform.stability.ai/account/keys", "1. 登录 Stability AI Platform。\n2. 在 API Keys 页面创建密钥。\n3. 复制密钥后返回 Lyra 执行连通性测试。")
  ],
  model: [
    preset("frostapi", "model", "FrostAPI 3D", "Frost", "openai-compatible", "openai-compatible", "https://api.linfrsot.cloud", ["frostapi", "frost", "frsotapi"], "https://api.linfrsot.cloud", "1. 在 FrostAPI 控制台创建 API Key。\n2. 连接会通过 OpenAI 兼容的 /models 接口读取可用模型。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("meshy", "model", "Meshy", "M", "openai-compatible", "meshy", "https://api.meshy.ai", ["meshy"], "https://www.meshy.ai/settings/api", "1. 登录 Meshy。\n2. 打开 API Settings 并创建 API Key。\n3. 复制密钥后返回 Lyra 执行连通性测试。"),
    preset("hunyuan", "model", "腾讯混元 3D", "HY", "openai-compatible", "hunyuan", "https://api.ai3d.cloud.tencent.com", ["hunyuan", "混元", "腾讯"], "https://console.cloud.tencent.com/hunyuan", "1. 登录腾讯云并开通混元生 3D。\n2. 在对应服务页面创建 API Key。\n3. 该密钥不是腾讯云 SecretId/SecretKey，请按控制台说明填写。"),
    preset("tripo", "model", "Tripo", "T", "openai-compatible", "tripo", "https://api.tripo3d.ai/v2/openapi", ["tripo"], "https://platform.tripo3d.ai", "1. 登录 Tripo Console。\n2. 在 API Keys 页面创建密钥。\n3. 复制 tsk_ 开头的 API Key 后返回 Lyra 执行测试。"),
    preset("stability-3d", "model", "Stability AI 3D", "S", "openai-compatible", "stability-3d", "https://api.stability.ai", ["stability", "spar3d", "fast3d"], "https://platform.stability.ai/account/keys", "1. 登录 Stability AI Platform。\n2. 在 API Keys 页面创建密钥。\n3. 复制密钥后返回 Lyra 执行连通性测试。")
  ]
};

function preset(
  id: string,
  serviceType: ProviderServiceType,
  name: string,
  shortName: string,
  protocol: ProviderProtocol,
  adapterType: ProviderAdapterType,
  baseUrl: string,
  aliases: string[],
  apiKeyWebsite?: string,
  apiKeyGuide?: string
): ProviderPreset {
  return {
    id,
    serviceType,
    name,
    shortName,
    protocol,
    adapterType,
    baseUrl,
    settings: {},
    aliases,
    ...(apiKeyWebsite ? { apiKeyWebsite } : {}),
    ...(apiKeyGuide ? { apiKeyGuide } : {})
  };
}

export function countServiceModels(
  profileId: string,
  serviceType: ProviderServiceType,
  models: ProviderModelSnapshot[]
): number {
  return models.filter((model) =>
    model.providerProfileId === profileId && model.serviceType === serviceType
  ).length;
}

export function findPresetProfile(
  presetValue: ProviderPreset,
  profiles: ProviderProfileSnapshot[]
): ProviderProfileSnapshot | undefined {
  return profiles.find((profile) => {
    if (profile.serviceType !== presetValue.serviceType) return false;
    if (readProviderKind(profile.settings) === presetValue.id) return true;
    if (profile.adapterType !== presetValue.adapterType) return false;
    const normalizedBaseUrl = profile.baseUrl.toLowerCase().replace(/\/+$/u, "");
    const presetBaseUrl = presetValue.baseUrl.toLowerCase().replace(/\/+$/u, "");
    if (normalizedBaseUrl === presetBaseUrl) return true;
    const name = profile.name.trim().toLowerCase();
    return presetValue.aliases.some((alias) => name.includes(alias.toLowerCase()));
  });
}

export function findProfilePreset(
  profile: ProviderProfileSnapshot
): ProviderPreset | null {
  const providerKind = readProviderKind(profile.settings);
  if (providerKind) {
    const direct = providerPresets[profile.serviceType]
      .find((item) => item.id === providerKind);
    if (direct) return direct;
  }
  return providerPresets[profile.serviceType]
    .find((item) => findPresetProfile(item, [profile])?.id === profile.id) ?? null;
}

export function isStarterProviderProfile(
  profile: ProviderProfileSnapshot
): boolean {
  const internal = profile.settings.__lyra;
  return Boolean(
    internal &&
    typeof internal === "object" &&
    !Array.isArray(internal) &&
    (internal as Record<string, unknown>).starter === true
  );
}

export function adapterLabel(adapterType: ProviderAdapterType): string {
  const labels: Partial<Record<ProviderAdapterType, string>> = {
    "dashscope-image": "DashScope 图像 API",
    "seedream-image": "火山方舟图像 API",
    "zhipu-image": "智谱图像 API",
    "hunyuan-image": "腾讯云签名 API",
    "stability-image": "Stability 图像 API",
    meshy: "Meshy API",
    hunyuan: "混元 3D API",
    tripo: "Tripo API",
    "stability-3d": "Stability 3D API"
  };
  return labels[adapterType] ?? protocolLabels[adapterType as ProviderProtocol] ?? adapterType;
}

function readProviderKind(settings: Record<string, unknown>): string | null {
  const internal = settings.__lyra;
  if (!internal || typeof internal !== "object" || Array.isArray(internal)) return null;
  const value = (internal as Record<string, unknown>).providerKind;
  return typeof value === "string" ? value : null;
}
