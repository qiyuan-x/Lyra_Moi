import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationUpdateService, compareVersions } from "@lyra/api";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("application update service", () => {
  it("compares numeric application versions", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0", "2.0.0")).toBe(-1);
  });

  it("checks a manifest and schedules the verified candidate", async () => {
    const directory = await createTemporaryDirectory();
    const launches: Array<{ command: readonly string[]; requestFile: string }> = [];
    const service = new ApplicationUpdateService({
      currentVersion: "0.0.2",
      baseDirectory: directory,
      stateFile: join(directory, "data", "run", "state.json"),
      requestFile: join(directory, "data", "run", "request.json"),
      manifestUrl: "https://updates.example.test/stable.json",
      helperCommand: ["LyraLauncher.exe", "--apply-update"],
      deploymentMode: "desktop",
      launchDelayMs: 0,
      fetchManifest: async () => ({
        schemaVersion: 1,
        version: "0.0.3",
        publishedAt: "2026-08-21T00:00:00Z",
        releaseNotes: ["新增一键升级"],
        artifacts: {
          "windows-x64": {
            url: "https://cdn.example.test/Lyra-update.zip",
            sha256: "a".repeat(64),
            size: 1024
          }
        }
      }),
      launchHelper: (command, requestFile) => launches.push({ command, requestFile })
    });

    await expect(service.check()).resolves.toMatchObject({
      status: "available",
      currentVersion: "0.0.2",
      latestVersion: "0.0.3",
      updateAvailable: true
    });
    await expect(service.apply()).resolves.toMatchObject({ status: "scheduled" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(launches).toEqual([{
      command: ["LyraLauncher.exe", "--apply-update"],
      requestFile: join(directory, "data", "run", "request.json")
    }]);
    const request = JSON.parse(
      await readFile(join(directory, "data", "run", "request.json"), "utf8")
    ) as Record<string, unknown>;
    expect(request).toMatchObject({
      schemaVersion: 1,
      currentVersion: "0.0.2",
      targetVersion: "0.0.3",
      platform: "windows-x64",
      port: 3000
    });
  });

  it("reports a bad manifest without scheduling an update", async () => {
    const directory = await createTemporaryDirectory();
    const service = new ApplicationUpdateService({
      currentVersion: "0.0.2",
      baseDirectory: directory,
      stateFile: join(directory, "state.json"),
      requestFile: join(directory, "request.json"),
      manifestUrl: "https://updates.example.test/stable.json",
      helperCommand: ["helper"],
      deploymentMode: "desktop",
      fetchManifest: async () => ({ schemaVersion: 1 })
    });
    await expect(service.check()).resolves.toMatchObject({
      status: "failed",
      updateAvailable: false
    });
    await expect(service.apply()).rejects.toThrow("No checked application update");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lyra-update-service-"));
  temporaryDirectories.push(directory);
  return directory;
}
