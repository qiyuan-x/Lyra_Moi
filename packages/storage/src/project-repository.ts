import { randomUUID } from "node:crypto";
import type { ImageMode, ProjectSnapshot } from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

const DEFAULT_PROJECT_SETTING = "default_project_id";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  last_image_mode: ImageMode;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface SettingRow {
  value_json: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  lastImageMode?: ImageMode;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  lastImageMode?: ImageMode;
}

export class ProjectRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  create(input: CreateProjectInput): ProjectSnapshot {
    const name = input.name.trim();
    if (!name) throw new Error("Project name is required.");
    const now = new Date().toISOString();
    const project: ProjectSnapshot = {
      id: randomUUID(),
      name,
      description: input.description?.trim() ?? "",
      lastImageMode: input.lastImageMode ?? "agent",
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.#database.connection
      .prepare(`
        INSERT INTO projects (
          id, name, description, last_image_mode, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        project.id,
        project.name,
        project.description,
        project.lastImageMode,
        project.createdAt,
        project.updatedAt
      );
    return structuredClone(project);
  }

  findById(projectId: string): ProjectSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, name, description, last_image_mode, created_at, updated_at, deleted_at
        FROM projects
        WHERE id = ?
      `)
      .get(projectId) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  listActive(): ProjectSnapshot[] {
    const rows = this.#database.connection
      .prepare(`
        SELECT id, name, description, last_image_mode, created_at, updated_at, deleted_at
        FROM projects
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC, id
      `)
      .all() as unknown as ProjectRow[];
    return rows.map(mapProject);
  }

  updateLastImageMode(projectId: string, lastImageMode: ImageMode): ProjectSnapshot {
    return this.update(projectId, { lastImageMode });
  }

  update(projectId: string, input: UpdateProjectInput): ProjectSnapshot {
    const existing = this.findById(projectId);
    if (!existing || existing.deletedAt !== null) throw new Error(`Project not found: ${projectId}`);
    const name = input.name === undefined ? existing.name : input.name.trim();
    if (!name) throw new Error("Project name is required.");
    const description = input.description === undefined
      ? existing.description
      : input.description.trim();
    const lastImageMode = input.lastImageMode ?? existing.lastImageMode;
    const updatedAt = new Date().toISOString();
    const result = this.#database.connection
      .prepare(`
        UPDATE projects
        SET name = ?, description = ?, last_image_mode = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `)
      .run(name, description, lastImageMode, updatedAt, projectId);
    if (result.changes !== 1) throw new Error(`Project not found: ${projectId}`);
    return this.findById(projectId)!;
  }

  archive(projectId: string): ProjectSnapshot {
    return this.#database.transaction(() => {
      const now = new Date().toISOString();
      const result = this.#database.connection
        .prepare(`
          UPDATE projects
          SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
        `)
        .run(now, now, projectId);
      if (result.changes !== 1) throw new Error(`Project not found: ${projectId}`);
      if (this.#readDefaultProjectId() === projectId) {
        const replacement = this.listActive()[0];
        if (replacement) this.#writeDefaultProjectId(replacement.id, now);
      }
      return this.findById(projectId)!;
    });
  }

  ensureDefaultProject(name = "默认项目"): ProjectSnapshot {
    return this.#database.transaction(() => {
      const configuredId = this.#readDefaultProjectId();
      if (configuredId) {
        const configuredProject = this.findById(configuredId);
        if (configuredProject && configuredProject.deletedAt === null) return configuredProject;
      }

      const project = this.listActive()[0] ?? this.create({ name });
      const now = new Date().toISOString();
      this.#writeDefaultProjectId(project.id, now);
      return project;
    });
  }

  #writeDefaultProjectId(projectId: string, updatedAt: string): void {
    this.#database.connection
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(DEFAULT_PROJECT_SETTING, JSON.stringify(projectId), updatedAt);
  }

  #readDefaultProjectId(): string | null {
    const row = this.#database.connection
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .get(DEFAULT_PROJECT_SETTING) as SettingRow | undefined;
    if (!row) return null;
    const value: unknown = JSON.parse(row.value_json);
    return typeof value === "string" && value ? value : null;
  }
}

function mapProject(row: ProjectRow): ProjectSnapshot {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    lastImageMode: row.last_image_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}
