import { access, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeLayout,
  ensureRuntimeLayout,
  resolveDataDirectory
} from "@lyra/storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("runtime data layout", () => {
  it("resolves development, server, and packaged desktop locations", () => {
    const workspace = resolve("C:/workspace/lyra");
    expect(resolveDataDirectory({ workingDirectory: workspace, environment: {} })).toBe(
      resolve(workspace, "data")
    );
    expect(
      resolveDataDirectory({
        workingDirectory: workspace,
        environment: { LYRA_DATA_DIR: "server-data" }
      })
    ).toBe(resolve(workspace, "server-data"));

    const launcher = resolve(workspace, "release", "LyraLauncher.exe");
    expect(
      resolveDataDirectory({
        workingDirectory: workspace,
        environment: {},
        launcherExecutablePath: launcher
      })
    ).toBe(resolve(dirname(launcher), "data"));
  });

  it("creates only the defined directories under the selected root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-layout-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));

    await ensureRuntimeLayout(layout);

    const expectedNames = [
      "blobs",
      "config",
      "database",
      "logs",
      "projects",
      "run",
      "temp",
      "thumbnails"
    ];
    expect((await readdir(layout.root)).sort()).toEqual(expectedNames);
    for (const directory of expectedNames) {
      expect((await stat(join(layout.root, directory))).isDirectory()).toBe(true);
    }
    await expect(access(layout.environmentFile)).rejects.toThrow();
    await expect(access(layout.databaseFile)).rejects.toThrow();
  });
});
