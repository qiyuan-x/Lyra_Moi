import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationUpdateService, createApiServer } from "@lyra/api";
import type { RuntimeEventFeed } from "@lyra/core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});
describe("application update HTTP routes", () => {
  it("returns the current version and checks the configured manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-update-route-"));
    temporaryDirectories.push(directory);
    const applicationUpdates = new ApplicationUpdateService({
      currentVersion: "0.0.2",
      baseDirectory: directory,
      stateFile: join(directory, "state.json"),
      requestFile: join(directory, "request.json"),
      manifestUrl: "https://updates.example.test/stable.json",
      helperCommand: ["helper"],
      deploymentMode: "desktop",
      fetchManifest: async () => ({
        schemaVersion: 1,
        version: "0.0.3",
        publishedAt: "2026-08-21T00:00:00Z",
        releaseNotes: [],
        artifacts: {
          "windows-x64": {
            url: "https://cdn.example.test/update.zip",
            sha256: "b".repeat(64),
            size: 2048
          }
        }
      })
    });
    const server = createApiServer({
      events: {} as RuntimeEventFeed,
      applicationUpdates
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const current = await fetch(`${baseUrl}/api/v1/system/update`);
      expect(current.status).toBe(200);
      await expect(current.json()).resolves.toMatchObject({
        currentVersion: "0.0.2",
        status: "idle"
      });
      const checked = await fetch(`${baseUrl}/api/v1/system/update/check`, { method: "POST" });
      expect(checked.status).toBe(200);
      await expect(checked.json()).resolves.toMatchObject({
        latestVersion: "0.0.3",
        status: "available"
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });
});
