import { normalizeTripoBaseUrl } from "@lyra/contracts";
import type {
  ProviderAccountSnapshot,
  ProviderAdapterType,
  ProviderUsageMetric,
  ProviderUsageSnapshot
} from "@lyra/contracts";
import type { ProviderRepository, SecretStore, StoredProviderProfile } from "@lyra/storage";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import { FrostApiUsageClient, type FrostApiUsageReader } from "./frostapi-usage.js";
import { credentialExpiry, parseImportedCredential } from "./imported-credential.js";

/** Reads account metadata and provider-reported quota without persisting tokens. */
export interface ProviderAccountServiceOptions {
  providers: ProviderRepository;
  secrets: SecretStore;
  frostApiUsage?: FrostApiUsageReader;
  httpClient?: ProviderHttpClient;
}

export class ProviderAccountService {
  readonly #providers: ProviderRepository;
  readonly #secrets: SecretStore;
  readonly #frost: FrostApiUsageReader;
  readonly #http: ProviderHttpClient;

  constructor(options: ProviderAccountServiceOptions) {
    this.#providers = options.providers;
    this.#secrets = options.secrets;
    this.#frost = options.frostApiUsage ?? new FrostApiUsageClient();
    this.#http = options.httpClient ?? new ProviderHttpClient({ timeoutMs: 15_000, maxResponseBytes: 256 * 1024 });
  }

  async getAccount(profileId: string, signal?: AbortSignal): Promise<ProviderAccountSnapshot> {
    let profile = this.#providers.requireProfile(profileId);
    const primary = await this.#secrets.get(profile.apiKeyEnvironmentVariable);
    const secondary = profile.secondaryApiKeyEnvironmentVariable
      ? await this.#secrets.get(profile.secondaryApiKeyEnvironmentVariable)
      : null;
    // Older imports saved only tokens. Recover display hints without storing the JWT itself.
    if (primary && ["oauth", "token", "json"].includes(String(profile.settings.authMode))) {
      const hints = parseImportedCredential(primary).settings;
      const settings = { ...profile.settings };
      for (const key of ["credentialAccount", "credentialAccountId", "credentialPlan", "credentialExpiresAt"]) {
        if (!settings[key] && hints[key]) settings[key] = hints[key];
      }
      profile = { ...profile, settings };
    }
    const credentialAccount = typeof profile.settings.credentialAccount === "string"
      ? profile.settings.credentialAccount
      : null;
    const usage = await this.#queryUsage(profile, primary, secondary, signal);
    return {
      profileId,
      account: credentialAccount,
      accountId: settingText(profile, "credentialAccountId"),
      provider: settingText(profile, "credentialProvider"),
      plan: settingText(profile, "credentialPlan"),
      subscriptionExpiresAt: settingText(profile, "credentialSubscriptionExpiresAt"),
      authMode: typeof profile.settings.authMode === "string" ? profile.settings.authMode : "api_key",
      hasAccessToken: Boolean(primary),
      hasRefreshToken: Boolean(secondary),
      expiresAt: typeof profile.settings.credentialExpiresAt === "string"
        ? profile.settings.credentialExpiresAt
        : null,
      usage
    };
  }

  async #queryUsage(
    profile: StoredProviderProfile,
    apiKey: string | null,
    _secondary: string | null,
    signal?: AbortSignal
  ): Promise<ProviderUsageSnapshot> {
    const adapterType = profile.adapterType as ProviderAdapterType;
    if (!apiKey?.trim()) return unsupported(adapterType, "未配置凭据，无法查询供应商额度。");

    if (adapterType === "openai" && profile.serviceType === "llm" &&
        new URL(profile.baseUrl).origin === "https://api.openai.com" &&
        ["oauth", "token", "json"].includes(String(profile.settings.authMode)) && settingText(profile, "credentialAccountId")) {
      const body = asRecord(await this.#http.getJson("https://chatgpt.com/backend-api/wham/usage", {
        ...bearer(apiKey), "ChatGPT-Account-Id": settingText(profile, "credentialAccountId")!
      }, signal));
      const metrics = codexUsageMetrics(body);
      return metrics.length
        ? { supported: true, adapterType, fetchedAt: new Date().toISOString(), metrics }
        : unsupported(adapterType, "账号接口未返回可用的额度窗口。");
    }

    if (isFrostApi(profile)) {
      const value = await this.#frost.query({ baseUrl: profile.baseUrl, apiKey, ...(signal ? { signal } : {}) });
      const metrics: ProviderUsageMetric[] = value.mode === "unrestricted"
        ? [{ key: "balance", label: value.planName, value: value.balance, unit: value.unit, remaining: value.remaining }]
        : [
            { key: "limit", label: "额度上限", value: value.quota.limit, unit: value.quota.unit },
            { key: "used", label: "已使用", value: value.quota.used, unit: value.quota.unit },
            { key: "remaining", label: "剩余额度", value: value.quota.remaining, unit: value.quota.unit }
          ];
      return { supported: true, adapterType, fetchedAt: new Date().toISOString(), metrics };
    }

    if (adapterType === "tripo") {
      const base = normalizeTripoBaseUrl(profile.baseUrl);
      let body: Record<string, unknown>;
      try {
        body = asRecord(await this.#http.getJson(`${base}/account/balance`, bearer(apiKey), signal));
      } catch (error) {
        // Older Tripo deployments expose the legacy endpoint.
        if (new URL(base).pathname.endsWith("/v3") || !(error instanceof ProviderConnectionError) || error.code !== "NOT_FOUND") throw error;
        body = asRecord(await this.#http.getJson(`${base}/user/balance`, bearer(apiKey), signal));
      }
      if (body.code !== 0) throw new ProviderConnectionError("BAD_REQUEST", typeof body.message === "string" ? body.message : "Tripo 额度查询失败。");
      const data = asRecord(body.data);
      const balance = readNumber(data.balance);
      if (balance === null) throw new ProviderConnectionError("INVALID_RESPONSE", "Tripo 额度响应缺少 balance。");
      return {
        supported: true,
        adapterType,
        fetchedAt: new Date().toISOString(),
        metrics: [{ key: "balance", label: "剩余额度", value: balance, unit: "credits" }]
      };
    }

    if (adapterType === "meshy") {
      const body = asRecord(await this.#http.getJson(`${trimSlash(profile.baseUrl)}/openapi/v1/balance`, bearer(apiKey), signal));
      const balance = readNumber(body.balance);
      if (balance === null) throw new ProviderConnectionError("INVALID_RESPONSE", "Meshy 额度响应缺少 balance。");
      return {
        supported: true,
        adapterType,
        fetchedAt: new Date().toISOString(),
        metrics: [{ key: "balance", label: "剩余额度", value: balance, unit: "credits" }]
      };
    }

    if (adapterType === "stability-image" || adapterType === "stability-3d") {
      const body = asRecord(await this.#http.getJson(`${trimSlash(profile.baseUrl).replace(/\/v1$/u, "")}/v1/user/account`, bearer(apiKey), signal));
      const metrics = readStabilityMetrics(body);
      if (!metrics.length) throw new ProviderConnectionError("INVALID_RESPONSE", "Stability 额度响应缺少可识别指标。");
      return { supported: true, adapterType, fetchedAt: new Date().toISOString(), metrics };
    }

    return unsupported(adapterType, "此供应商未提供标准额度查询接口，请在供应商控制台查看。");
  }
}

function codexUsageMetrics(body: Record<string, unknown>): ProviderUsageMetric[] {
  const metrics: ProviderUsageMetric[] = [];
  for (const [group, label] of [["rate_limit", "调用"], ["code_review_rate_limit", "代码审查"]]) {
    const limits = body[group!];
    if (!limits || typeof limits !== "object") continue;
    for (const key of ["primary_window", "secondary_window"]) {
      const window = (limits as Record<string, unknown>)[key];
      if (!window || typeof window !== "object") continue;
      const value = window as Record<string, unknown>;
      const used = readNumber(value.used_percent);
      if (used === null) continue; // Missing means unknown, not 100% remaining.
      const seconds = readNumber(value.limit_window_seconds);
      const duration = seconds === 604800 ? "每周" : seconds === 18000 ? "5 小时" : seconds ? `${Math.round(seconds / 60)} 分钟` : key === "primary_window" ? "主窗口" : "次窗口";
      const remaining = 100 - Math.min(100, Math.max(0, used));
      const relative = readNumber(value.reset_after_seconds);
      const reset = credentialExpiry(value.reset_at ?? (relative !== null && relative >= 0 ? Date.now() / 1000 + relative : null));
      metrics.push({ key: `${group}.${key}`, label: `${label} ${duration}剩余`, value: remaining, unit: "%", limit: 100, remaining, ...(reset ? { resetAt: reset } : {}) });
    }
  }
  return metrics;
}

function settingText(profile: StoredProviderProfile, key: string): string | null {
  const value = profile.settings[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function isFrostApi(profile: StoredProviderProfile): boolean {
  const metadata = profile.settings.__lyra;
  return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).providerKind === "frostapi";
}

function unsupported(adapterType: ProviderAdapterType, reason: string): ProviderUsageSnapshot {
  return { supported: false, adapterType, fetchedAt: null, reason };
}

function bearer(apiKey: string): Record<string, string> {
  return { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "").replace(/\/v1$/u, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderConnectionError("INVALID_RESPONSE", "供应商额度响应格式无效。");
  }
  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStabilityMetrics(body: Record<string, unknown>): ProviderUsageMetric[] {
  const metrics: ProviderUsageMetric[] = [];
  const candidates: Array<[string, string]> = [
    ["credits", "剩余 credits"],
    ["balance", "余额"],
    ["usage", "已使用"],
    ["limit", "额度上限"]
  ];
  for (const [key, label] of candidates) {
    const value = readNumber(body[key]);
    if (value !== null) metrics.push({ key, label, value, unit: "credits" });
  }
  return metrics;
}
