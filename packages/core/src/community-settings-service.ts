import type {
  CommunitySettings,
  CommunitySettingsSnapshot
} from "@lyra/contracts";
import type { AppSettingsRepository } from "@lyra/storage";

const SETTINGS_KEY = "community.url";
export const DEFAULT_COMMUNITY_URL = "https://linfrsot.cloud/lyra/community/";

type SettingsStore = Pick<AppSettingsRepository, "get" | "set" | "delete">;

export class CommunitySettingsService {
  readonly #settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.#settings = settings;
  }

  get(): CommunitySettings {
    const stored = this.#settings.get(SETTINGS_KEY);
    return {
      url: typeof stored === "string" && stored.trim()
        ? stored
        : DEFAULT_COMMUNITY_URL
    };
  }

  snapshot(): CommunitySettingsSnapshot {
    return { settings: this.get() };
  }

  update(value: unknown): CommunitySettingsSnapshot {
    if (!isRecord(value)) throw new Error("Community settings must be an object.");
    const current = this.get();
    const url = "url" in value ? validateCommunityUrl(value.url) : current.url;
    if (url && url !== DEFAULT_COMMUNITY_URL) {
      this.#settings.set(SETTINGS_KEY, url);
    } else {
      this.#settings.delete(SETTINGS_KEY);
    }
    return this.snapshot();
  }
}

export function validateCommunityUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("社区网址必须是字符串。");
  const normalized = value.trim();
  if (!normalized) return "";
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("社区网址格式无效。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("社区网址只支持 http:// 或 https://。");
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
