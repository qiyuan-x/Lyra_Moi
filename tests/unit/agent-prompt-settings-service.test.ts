import { describe, expect, it } from "vitest";
import {
  AgentPromptSettingsService
} from "@lyra/core";
import type { AgentPromptSettings } from "@lyra/contracts";

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

const defaults: AgentPromptSettings = {
  systemPrompt: "默认系统提示词",
  optimizeEnabledPrompt: "默认允许优化",
  optimizeDisabledPrompt: "默认禁止优化"
};

describe("Agent prompt settings service", () => {
  it("updates individual prompts and restores defaults", () => {
    const store = new MemorySettings();
    const service = new AgentPromptSettingsService(store, defaults);

    expect(service.snapshot()).toEqual({
      settings: defaults,
      defaults
    });

    expect(service.update({
      systemPrompt: "  自定义系统提示词  "
    }).settings).toEqual({
      ...defaults,
      systemPrompt: "自定义系统提示词"
    });
    expect(service.reset()).toEqual({
      settings: defaults,
      defaults
    });
    expect(store.values.size).toBe(0);
  });

  it("rejects blank and oversized prompts", () => {
    const service = new AgentPromptSettingsService(
      new MemorySettings(),
      defaults
    );

    expect(() => service.update({ systemPrompt: "   " }))
      .toThrow("systemPrompt cannot be blank");
    expect(() => service.update({
      optimizeEnabledPrompt: "x".repeat(30_001)
    })).toThrow("optimizeEnabledPrompt cannot exceed 30000 characters");
  });
});
