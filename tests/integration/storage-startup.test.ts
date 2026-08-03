import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectRepository,
  createRuntimeLayout,
  migrateRuntimeDatabase,
  openReadyRuntimeDatabase
} from "@lyra/storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("storage startup", () => {
  it("requires explicit migration and creates one stable default project", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-startup-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));

    await expect(openReadyRuntimeDatabase(layout)).rejects.toThrow(
      "Database migrations have not been applied"
    );
    expect(await migrateRuntimeDatabase(layout)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

    const database = await openReadyRuntimeDatabase(layout);
    try {
      const projects = new ProjectRepository(database);
      const first = projects.ensureDefaultProject();
      const second = projects.ensureDefaultProject();
      expect(second.id).toBe(first.id);
      expect(projects.listActive()).toEqual([first]);
    } finally {
      database.close();
    }
  });
});
