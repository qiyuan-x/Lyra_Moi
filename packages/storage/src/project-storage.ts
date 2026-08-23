import { constants, rmSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { AssetSource } from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";
import type { RuntimeLayout } from "./runtime-layout.js";

interface LegacyAssetRow {
  id: string;
  project_id: string;
  source: AssetSource;
  blob_key: string;
  checksum_sha256: string;
}

export class ProjectDirectoryStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  ensure(projectId: string): void {
    const projectRoot = resolveProjectRoot(this.root, projectId);
    for (const directory of [
      resolve(projectRoot, "uploads", "images"),
      resolve(projectRoot, "uploads", "thumbnails"),
      resolve(projectRoot, "generated", "images"),
      resolve(projectRoot, "generated", "models"),
      resolve(projectRoot, "generated", "thumbnails"),
      resolve(projectRoot, "temp")
    ]) {
      mkdirSync(directory, { recursive: true });
    }
  }

  delete(projectId: string): void {
    rmSync(resolveProjectRoot(this.root, projectId), {
      recursive: true,
      force: true
    });
  }
}

export async function migrateLegacyProjectAssets(
  database: LyraDatabase,
  layout: RuntimeLayout
): Promise<number> {
  const rows = database.connection
    .prepare(`
      SELECT id, project_id, source, blob_key, checksum_sha256
      FROM assets
      WHERE blob_key LIKE 'sha256/%'
      ORDER BY created_at, id
    `)
    .all() as unknown as LegacyAssetRow[];
  if (rows.length === 0) return 0;

  const directories = new ProjectDirectoryStore(layout.projects);
  let migrated = 0;
  for (const row of rows) {
    directories.ensure(row.project_id);
    const sourceFolder = row.source === "upload" ? "uploads" : "generated";
    const newKey = `${row.project_id}/${sourceFolder}/images/${row.blob_key}`;
    const sourcePath = resolveStorageKey(layout.blobs, row.blob_key);
    const targetPath = resolveStorageKey(layout.projects, newKey);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyIfNeeded(sourcePath, targetPath);

    const legacyThumbnail = resolve(
      layout.thumbnails,
      row.checksum_sha256.slice(0, 2),
      row.checksum_sha256.slice(2, 4),
      `${row.checksum_sha256}.webp`
    );
    const projectThumbnail = resolve(
      layout.projects,
      row.project_id,
      sourceFolder,
      "thumbnails",
      row.checksum_sha256.slice(0, 2),
      row.checksum_sha256.slice(2, 4),
      `${row.checksum_sha256}.webp`
    );
    await mkdir(dirname(projectThumbnail), { recursive: true });
    await copyIfNeeded(legacyThumbnail, projectThumbnail, true);

    const result = database.connection
      .prepare("UPDATE assets SET blob_key = ? WHERE id = ? AND blob_key = ?")
      .run(newKey, row.id, row.blob_key);
    if (result.changes === 1) migrated += 1;
  }
  return migrated;
}

function resolveProjectRoot(root: string, projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized === "..") {
    throw new Error("Project storage ID is invalid.");
  }
  const target = resolve(root, normalized);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Project path escapes the storage root.");
  return target;
}

function resolveStorageKey(root: string, key: string): string {
  const target = resolve(root, ...key.split("/"));
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error("Storage key escapes its root.");
  return target;
}

async function copyIfNeeded(source: string, target: string, sourceMayBeMissing = false): Promise<void> {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "EEXIST") {
      const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(target)]);
      if (sourceInfo.size !== targetInfo.size) throw new Error(`Migrated file size mismatch: ${target}`);
      return;
    }
    if (sourceMayBeMissing && code === "ENOENT") return;
    throw error;
  }
}

function getErrorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error
    ? ((error as NodeJS.ErrnoException).code ?? null)
    : null;
}
