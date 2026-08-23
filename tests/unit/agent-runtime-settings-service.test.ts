import { describe, expect, it } from "vitest";
import { AgentRuntimeSettingsService } from "@lyra/core";

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

describe("Agent runtime settings service", () => {
  it("updates and resets the maximum tool call count", () => {
    const store = new MemorySettings();
    const service = new AgentRuntimeSettingsService(store);

    expect(service.snapshot().settings.maxToolCalls).toBe(10);
    expect(service.update({ maxToolCalls: 24 }).settings.maxToolCalls).toBe(24);
    expect(store.values.get("agent_max_tool_calls")).toBe(24);
    expect(service.reset().settings.maxToolCalls).toBe(10);
    expect(store.values.has("agent_max_tool_calls")).toBe(false);
  });

  it("rejects values outside the supported range", () => {
    const service = new AgentRuntimeSettingsService(new MemorySettings());
    expect(() => service.update({ maxToolCalls: 0 })).toThrow("between 1 and 100");
    expect(() => service.update({ maxToolCalls: 101 })).toThrow("between 1 and 100");
    expect(() => service.update({ maxToolCalls: 1.5 })).toThrow("between 1 and 100");
  });
});
