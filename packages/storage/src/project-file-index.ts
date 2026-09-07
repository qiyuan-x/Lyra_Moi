import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { ProjectSnapshot } from "@lyra/contracts";
import { AssetRepository, type StoredAsset } from "./asset-repository.js";
import { ProjectRepository } from "./project-repository.js";
import { SharpImageProcessor } from "./image-processor.js";
import { ThumbnailStore } from "./blob-store.js";
import type { LyraDatabase } from "./database.js";
import type { RuntimeLayout } from "./runtime-layout.js";

export const PROJECT_INDEX_FILE = "lyra-project.json";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const categories = ["uploads/images", "generated/images", "generated/models"];
const modelTypes: Record<string, string> = { ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".obj": "model/obj", ".fbx": "application/octet-stream", ".zip": "application/zip" };
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

interface ProjectFileIndex {
  schemaVersion: 1;
  project: ProjectSnapshot;
  assets: StoredAsset[];
}

export interface ProjectIndexReport {
  imported: Array<{ projectId: string; assets: number; recovered: boolean }>;
  errors: Array<{ projectId: string; message: string }>;
}

/** Central SQLite remains authoritative; project folders carry a portable asset index.
 * No credentials, global settings or executable jobs are imported from copied folders.
 */
export async function synchronizeProjectFolders(database: LyraDatabase, layout: RuntimeLayout): Promise<ProjectIndexReport> {
  const report: ProjectIndexReport = { imported: [], errors: [] };
  const projects = new ProjectRepository(database);
  mkdirSync(layout.projects, { recursive: true });
  for (const directory of readdirSync(layout.projects, { withFileTypes: true })) {
    const id = directory.name;
    if (!directory.isDirectory() || directory.isSymbolicLink() || !uuid.test(id) || projects.findById(id)) continue;
    try {
      const root = safePath(layout.projects, id);
      const manifest = resolve(root, PROJECT_INDEX_FILE);
      const recovered = !existsSync(manifest);
      const index = recovered ? await recoverFolder(root, id, layout) : readIndex(manifest, id);
      if (!index) continue;
      validateFiles(layout.projects, index);
      database.transaction(() => {
        // API and Worker may discover the same folder concurrently.
        if (projects.findById(id)) return;
        insertIndex(database, index);
        report.imported.push({ projectId: id, assets: index.assets.filter((asset) => !asset.deletedAt).length, recovered });
      });
    } catch (error) {
      report.errors.push({ projectId: id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  database.projectIndexWriter = (id) => writeProjectIndex(database, layout, id);
  for (const project of projects.listActive()) {
    try { writeProjectIndex(database, layout, project.id); }
    catch (error) { report.errors.push({ projectId: project.id, message: error instanceof Error ? error.message : String(error) }); }
  }
  return report;
}

export function writeProjectIndex(database: LyraDatabase, layout: RuntimeLayout, projectId: string): void {
  database.transaction(() => {
    const project = new ProjectRepository(database).findById(projectId);
    if (!project || project.deletedAt) return;
    const repository = new AssetRepository(database);
    const ids = database.connection.prepare("SELECT id FROM assets WHERE project_id = ? ORDER BY id").all(projectId) as Array<{ id: string }>;
    const index: ProjectFileIndex = { schemaVersion: 1, project, assets: ids.map(({ id }) => repository.requireStored(id, true)) };
    const root = safePath(layout.projects, projectId);
    mkdirSync(root, { recursive: true });
    const file = safePath(root, PROJECT_INDEX_FILE);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(index, null, 2) + "\n", { flag: "wx" });
      renameSync(temporary, file);
    } finally { rmSync(temporary, { force: true }); }
  });
}

function readIndex(file: string, projectId: string): ProjectFileIndex {
  if (lstatSync(file).isSymbolicLink() || statSync(file).size > 32 * 1024 * 1024) throw new Error("项目索引文件无效。");
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!record(value) || value.schemaVersion !== 1 || !record(value.project) || !Array.isArray(value.assets) || value.assets.length > 100_000) throw new Error("不支持的项目索引格式。");
  const p = value.project;
  if (p.id !== projectId || !text(p.name) || typeof p.description !== "string" || !["manual", "agent"].includes(String(p.lastImageMode)) || !date(p.createdAt) || !date(p.updatedAt) || p.deletedAt !== null) throw new Error("项目索引信息无效或目录已被改名。");
  const ids = new Set<string>();
  for (const a of value.assets) {
    if (!record(a) || !text(a.id) || ids.has(a.id) || a.projectId !== projectId || !["image", "model", "file"].includes(String(a.kind)) || !["upload", "generated"].includes(String(a.source)) || !text(a.name) || !(a.originalName === null || typeof a.originalName === "string") || !text(a.mimeType) || !text(a.blobKey) || typeof a.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(a.checksumSha256) || !Number.isSafeInteger(a.byteSize) || Number(a.byteSize) < 0 || !nullableDimension(a.width) || !nullableDimension(a.height) || !date(a.createdAt) || !date(a.updatedAt) || !(a.deletedAt === null || date(a.deletedAt)) || !Array.isArray(a.tags) || a.tags.length > 50 || a.tags.some((tag: unknown) => typeof tag !== "string" || tag.length > 50)) throw new Error("项目素材索引无效或含重复 ID。");
    ids.add(a.id);
  }
  return value as unknown as ProjectFileIndex;
}

function validateFiles(projectsRoot: string, index: ProjectFileIndex): void {
  for (const asset of index.assets) {
    const prefix = `${index.project.id}/${asset.source === "upload" ? "uploads/images" : asset.kind === "model" ? "generated/models" : "generated/images"}/`;
    if (!asset.blobKey.startsWith(prefix)) throw new Error("素材路径不属于当前项目。");
    const file = safePath(projectsRoot, asset.blobKey);
    if (asset.deletedAt) continue;
    if (!statSync(file).isFile() || statSync(file).size !== asset.byteSize || checksum(file) !== asset.checksumSha256) throw new Error(`素材未复制完整或校验不符：${asset.blobKey}`);
  }
}

async function recoverFolder(root: string, id: string, layout: RuntimeLayout): Promise<ProjectFileIndex | null> {
  if (![...categories, "animations"].some((folder) => existsSync(resolve(root, folder)))) return null;
  const now = new Date().toISOString();
  const index: ProjectFileIndex = { schemaVersion: 1, project: { id, name: `恢复项目 ${id.slice(0, 8)}`, description: "从无索引的旧项目目录恢复；不包含原对话和任务记录。", lastImageMode: "agent", createdAt: now, updatedAt: now, deletedAt: null }, assets: [] };
  const images = new SharpImageProcessor();
  for (const category of categories) {
    const folder = safePath(root, category);
    if (!existsSync(folder)) continue;
    for (const file of walkFiles(folder)) {
      const extension = extname(file).toLowerCase();
      const isModel = category === "generated/models";
      if (!(isModel ? modelTypes[extension] : imageExtensions.has(extension))) continue;
      const key = `${id}/${relative(root, file).split(sep).join("/")}`;
      const sha = checksum(file);
      const source = category.startsWith("uploads/") ? "upload" : "generated";
      const image = isModel ? null : await images.process(readFileSync(file));
      if (image) await new ThumbnailStore(layout.projects).put(sha, image.thumbnail, { projectId: id, source });
      const createdAt = statSync(file).mtime.toISOString();
      index.assets.push({ id: randomUUID(), projectId: id, kind: isModel ? "model" : "image", source, name: basename(file), originalName: basename(file), mimeType: image?.mimeType ?? modelTypes[extension]!, blobKey: key, checksumSha256: sha, byteSize: statSync(file).size, width: image?.width ?? null, height: image?.height ?? null, tags: [], createdAt, updatedAt: createdAt, deletedAt: null });
    }
  }
  return index;
}

function insertIndex(database: LyraDatabase, index: ProjectFileIndex): void {
  const p = index.project;
  const db = database.connection;
  db.prepare("INSERT INTO projects (id, name, description, last_image_mode, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(p.id, p.name, p.description, p.lastImageMode, p.createdAt, p.updatedAt);
  const insert = db.prepare("INSERT INTO assets (id, project_id, kind, source, name, original_name, mime_type, blob_key, checksum_sha256, byte_size, width, height, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const tag = db.prepare("INSERT INTO asset_tags (asset_id, tag, created_at) VALUES (?, ?, ?)");
  for (const a of index.assets) {
    // Plain INSERT deliberately rejects conflicts rather than replacing existing data.
    insert.run(a.id, p.id, a.kind, a.source, a.name, a.originalName, a.mimeType, a.blobKey, a.checksumSha256, a.byteSize, a.width, a.height, a.createdAt, a.updatedAt, a.deletedAt);
    for (const t of new Set(a.tags)) tag.run(a.id, t, a.createdAt);
  }
}

function safePath(root: string, key: string): string {
  const parts = key.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:]/u.test(part))) throw new Error("项目路径无效。");
  let path = resolve(root);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("项目目录不允许符号链接。");
  for (const part of parts) {
    path = resolve(path, part);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("项目目录不允许符号链接。");
  }
  return path;
}

function* walkFiles(root: string): Generator<string> {
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error("项目目录不允许符号链接。");
    const path = resolve(root, item.name);
    if (item.isDirectory()) yield* walkFiles(path);
    else if (item.isFile()) yield path;
  }
}
function checksum(file: string): string { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function date(value: unknown): value is string { return text(value) && Number.isFinite(Date.parse(value)); }
function nullableDimension(value: unknown): boolean { return value === null || Number.isSafeInteger(value) && Number(value) > 0; }
