import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type {
  ProjectAnimationClipSnapshot,
  ProjectAnimationFormat,
  ProjectAnimationSnapshot
} from "@lyra/contracts";
import type { ProjectRepository } from "./project-repository.js";

export interface CreateProjectAnimationInput {
  projectId: string;
  originalName: string;
  name?: string;
  data: Uint8Array;
  clips: ProjectAnimationClipSnapshot[];
}

export interface ProjectAnimationContent {
  animation: ProjectAnimationSnapshot;
  data: Buffer;
  etag: string;
}

const maximumAnimationBytes = 200 * 1024 * 1024;

export class ProjectAnimationStore {
  readonly #root: string;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    root: string,
    private readonly projects: ProjectRepository
  ) {
    this.#root = resolve(root);
  }

  async list(projectId: string): Promise<ProjectAnimationSnapshot[]> {
    this.#requireProject(projectId);
    const items = await this.#readIndex(projectId);
    return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(input: CreateProjectAnimationInput): Promise<ProjectAnimationSnapshot> {
    return this.#mutate(async () => {
      this.#requireProject(input.projectId);
      const originalName = validateFileName(input.originalName);
      const format = animationFormat(originalName);
      const data = Buffer.from(input.data);
      validateAnimationFile(data, format);
      const clips = validateClips(input.clips);
      const checksumSha256 = createHash("sha256").update(data).digest("hex");
      const items = await this.#readIndex(input.projectId);
      const duplicate = items.find((item) =>
        item.checksumSha256 === checksumSha256 && item.originalName === originalName
      );
      if (duplicate) return duplicate;

      const id = randomUUID();
      const now = new Date().toISOString();
      const defaultName = originalName.slice(0, -extname(originalName).length);
      const animation: ProjectAnimationSnapshot = {
        id,
        projectId: input.projectId,
        name: uniqueName(validateName(input.name ?? defaultName), items),
        originalName,
        format,
        mimeType: format === "glb" ? "model/gltf-binary" : "application/octet-stream",
        byteSize: data.byteLength,
        checksumSha256,
        clips,
        createdAt: now,
        updatedAt: now
      };
      const directory = await this.#ensureDirectory(input.projectId);
      const filePath = resolveInside(directory, `${id}.${format}`);
      await writeFile(filePath, data, { flag: "wx" });
      try {
        await this.#writeIndex(input.projectId, [...items, animation]);
      } catch (error) {
        await unlink(filePath).catch(() => undefined);
        throw error;
      }
      return structuredClone(animation);
    });
  }

  async updateName(
    projectId: string,
    animationId: string,
    name: string
  ): Promise<ProjectAnimationSnapshot> {
    return this.#mutate(async () => {
      this.#requireProject(projectId);
      const items = await this.#readIndex(projectId);
      const index = items.findIndex((item) => item.id === animationId);
      if (index < 0) throw new Error(`Project animation not found: ${animationId}`);
      const existing = items[index]!;
      const updated: ProjectAnimationSnapshot = {
        ...existing,
        name: uniqueName(validateName(name), items.filter((item) => item.id !== animationId)),
        updatedAt: new Date().toISOString()
      };
      items[index] = updated;
      await this.#writeIndex(projectId, items);
      return structuredClone(updated);
    });
  }

  async delete(projectId: string, animationId: string): Promise<ProjectAnimationSnapshot> {
    return this.#mutate(async () => {
      this.#requireProject(projectId);
      const items = await this.#readIndex(projectId);
      const animation = items.find((item) => item.id === animationId);
      if (!animation) throw new Error(`Project animation not found: ${animationId}`);
      await unlink(this.#filePath(animation)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await this.#writeIndex(projectId, items.filter((item) => item.id !== animationId));
      return structuredClone(animation);
    });
  }

  async getContent(projectId: string, animationId: string): Promise<ProjectAnimationContent> {
    this.#requireProject(projectId);
    const animation = (await this.#readIndex(projectId)).find((item) => item.id === animationId);
    if (!animation) throw new Error(`Project animation not found: ${animationId}`);
    return {
      animation: structuredClone(animation),
      data: await readFile(this.#filePath(animation)),
      etag: `"${animation.checksumSha256}"`
    };
  }

  async #readIndex(projectId: string): Promise<ProjectAnimationSnapshot[]> {
    const directory = this.#directory(projectId);
    try {
      const parsed: unknown = JSON.parse(await readFile(resolveInside(directory, "index.json"), "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Project animation index is invalid.");
      return parsed.map(readAnimationSnapshot);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Project animation index is invalid.");
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async #writeIndex(projectId: string, items: ProjectAnimationSnapshot[]): Promise<void> {
    const directory = await this.#ensureDirectory(projectId);
    const destination = resolveInside(directory, "index.json");
    const temporary = resolveInside(directory, `index-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, "utf8");
    try {
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  #filePath(animation: ProjectAnimationSnapshot): string {
    return resolveInside(this.#directory(animation.projectId), `${animation.id}.${animation.format}`);
  }

  #directory(projectId: string): string {
    const projectRoot = resolveInside(this.#root, projectId);
    return resolveInside(projectRoot, "animations");
  }

  async #ensureDirectory(projectId: string): Promise<string> {
    const directory = this.#directory(projectId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  #requireProject(projectId: string): void {
    const project = this.projects.findById(projectId);
    if (!project || project.deletedAt !== null) throw new Error(`Project not found: ${projectId}`);
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationQueue;
    let release: () => void = () => undefined;
    this.#mutationQueue = new Promise<void>((resolveQueue) => { release = resolveQueue; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function animationFormat(fileName: string): ProjectAnimationFormat {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".fbx") return "fbx";
  if (extension === ".glb") return "glb";
  throw new Error("UE5 animation file must be FBX or GLB.");
}

function validateAnimationFile(data: Buffer, format: ProjectAnimationFormat): void {
  if (data.byteLength < 16 || data.byteLength > maximumAnimationBytes) {
    throw new Error("UE5 animation file size is invalid.");
  }
  if (format === "glb") {
    if (
      data.toString("ascii", 0, 4) !== "glTF" ||
      data.readUInt32LE(4) !== 2 ||
      data.readUInt32LE(8) !== data.byteLength
    ) {
      throw new Error("GLB animation header is invalid.");
    }
    return;
  }
  const header = data.subarray(0, 32).toString("ascii");
  if (!header.startsWith("Kaydara FBX Binary") && !header.trimStart().startsWith("; FBX")) {
    throw new Error("FBX animation header is invalid.");
  }
}

function validateClips(value: ProjectAnimationClipSnapshot[]): ProjectAnimationClipSnapshot[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) {
    throw new Error("UE5 animation clips are invalid.");
  }
  return value.map((clip, index) => {
    const name = clip.name?.trim();
    if (!name || name.length > 160 || !Number.isFinite(clip.duration) || clip.duration < 0) {
      throw new Error(`UE5 animation clip ${index + 1} is invalid.`);
    }
    return { name, duration: clip.duration };
  });
}

function validateFileName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 240 || /[\\/:*?"<>|\u0000-\u001f]/u.test(name)) {
    throw new Error("UE5 animation file name is invalid.");
  }
  return name;
}

function validateName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new Error("UE5 animation name is invalid.");
  return name;
}

function uniqueName(name: string, items: ProjectAnimationSnapshot[]): string {
  const existing = new Set(items.map((item) => item.name.toLocaleLowerCase()));
  if (!existing.has(name.toLocaleLowerCase())) return name;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${name} (${index})`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("Unable to create a unique UE5 animation name.");
}

function readAnimationSnapshot(value: unknown): ProjectAnimationSnapshot {
  if (!value || typeof value !== "object") throw new Error("Project animation index is invalid.");
  const item = value as Partial<ProjectAnimationSnapshot>;
  const strings = [
    item.id,
    item.projectId,
    item.name,
    item.originalName,
    item.mimeType,
    item.checksumSha256,
    item.createdAt,
    item.updatedAt
  ];
  if (
    strings.some((entry) => typeof entry !== "string" || !entry) ||
    (item.format !== "fbx" && item.format !== "glb") ||
    !Number.isSafeInteger(item.byteSize) || (item.byteSize ?? 0) < 1 ||
    !Array.isArray(item.clips)
  ) {
    throw new Error("Project animation index is invalid.");
  }
  return {
    id: item.id!,
    projectId: item.projectId!,
    name: item.name!,
    originalName: item.originalName!,
    format: item.format,
    mimeType: item.mimeType!,
    byteSize: item.byteSize!,
    checksumSha256: item.checksumSha256!,
    clips: validateClips(item.clips),
    createdAt: item.createdAt!,
    updatedAt: item.updatedAt!
  };
}

function resolveInside(root: string, child: string): string {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, child);
  if (!target.startsWith(`${normalizedRoot}${sep}`)) throw new Error("Project animation path is invalid.");
  return target;
}
