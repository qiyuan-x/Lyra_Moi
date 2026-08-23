import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApiServer } from "@lyra/api";
import {
  CommunitySettingsService,
  DEFAULT_COMMUNITY_URL,
  type RuntimeEventFeed
} from "@lyra/core";

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

describe("community settings HTTP routes", () => {
  it("reads, validates, and updates the local community URL", async () => {
    const server = createApiServer({
      events: {} as RuntimeEventFeed,
      communitySettings: new CommunitySettingsService(new MemorySettings())
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const empty = await fetch(`${baseUrl}/api/v1/settings/community`);
      expect(empty.status).toBe(200);
      await expect(empty.json()).resolves.toEqual({
        settings: { url: DEFAULT_COMMUNITY_URL }
      });

      const updated = await fetch(`${baseUrl}/api/v1/settings/community`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://linfrsot.cloud/lyra/community/" })
      });
      expect(updated.status).toBe(200);
      await expect(updated.json()).resolves.toEqual({
        settings: { url: "https://linfrsot.cloud/lyra/community/" }
      });

      const invalid = await fetch(`${baseUrl}/api/v1/settings/community`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "javascript:alert(1)" })
      });
      expect(invalid.status).toBe(400);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });
});
