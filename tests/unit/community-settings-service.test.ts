import { describe, expect, it } from "vitest";
import { CommunitySettingsService, DEFAULT_COMMUNITY_URL } from "@lyra/core";

class MemorySettings {
  readonly values = new Map<string, unknown>();

  get(key: string): unknown | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value));
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

describe("community settings service", () => {
  it("stores and clears an HTTP community URL", () => {
    const store = new MemorySettings();
    const service = new CommunitySettingsService(store);

    expect(service.snapshot()).toEqual({ settings: { url: DEFAULT_COMMUNITY_URL } });
    expect(service.update({
      url: " https://linfrsot.cloud/lyra/community/ "
    })).toEqual({
      settings: { url: "https://linfrsot.cloud/lyra/community/" }
    });
    expect(store.values.has("community.url")).toBe(false);
    expect(service.update({ url: "" })).toEqual({
      settings: { url: DEFAULT_COMMUNITY_URL }
    });
    expect(store.values.has("community.url")).toBe(false);
  });

  it("rejects unsupported and invalid URLs", () => {
    const service = new CommunitySettingsService(new MemorySettings());
    expect(() => service.update({ url: "ftp://example.com" })).toThrow("http://");
    expect(() => service.update({ url: "community.example.com" })).toThrow("格式无效");
    expect(() => service.update({ url: 123 })).toThrow("必须是字符串");
  });
});
