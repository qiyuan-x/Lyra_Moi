import { randomUUID } from "node:crypto";
import type {
  CreatePromptTemplateRequestBody,
  PromptTemplateListQuery,
  PromptTemplateSnapshot,
  UpdatePromptTemplateRequestBody
} from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface PromptTemplateRow {
  id: string;
  name: string;
  category: string;
  note: string | null;
  content: string;
  variables_json: string | null;
  favorite: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class PromptTemplateRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  list(query: PromptTemplateListQuery = {}): PromptTemplateSnapshot[] {
    const where = ["deleted_at IS NULL"];
    const parameters: Array<string | number> = [];
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      where.push(`(
        name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\'
        OR content LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'
      )`);
      parameters.push(pattern, pattern, pattern, pattern);
    }
    const category = query.category?.trim();
    if (category) {
      where.push("category = ?");
      parameters.push(category);
    }
    if (query.favorite !== undefined) {
      where.push("favorite = ?");
      parameters.push(query.favorite ? 1 : 0);
    }
    const rows = this.#database.connection
      .prepare(`
        SELECT id, name, category, note, content, variables_json,
               favorite, created_at, updated_at, deleted_at
        FROM prompt_templates
        WHERE ${where.join(" AND ")}
        ORDER BY favorite DESC, updated_at DESC, name
      `)
      .all(...parameters) as unknown as PromptTemplateRow[];
    return rows.map(mapPrompt);
  }

  findById(promptId: string): PromptTemplateSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, name, category, note, content, variables_json,
               favorite, created_at, updated_at, deleted_at
        FROM prompt_templates
        WHERE id = ? AND deleted_at IS NULL
      `)
      .get(promptId) as PromptTemplateRow | undefined;
    return row ? mapPrompt(row) : null;
  }

  requireById(promptId: string): PromptTemplateSnapshot {
    const prompt = this.findById(promptId);
    if (!prompt) throw new Error(`Prompt template not found: ${promptId}`);
    return prompt;
  }

  create(input: CreatePromptTemplateRequestBody): PromptTemplateSnapshot {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(`
        INSERT INTO prompt_templates (
          id, name, category, note, content, variables_json,
          favorite, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        id,
        input.name,
        input.category ?? "",
        input.note ?? null,
        input.content,
        JSON.stringify(normalizeVariables(input.variables ?? [])),
        input.favorite ? 1 : 0,
        now,
        now
      );
    return this.requireById(id);
  }

  update(promptId: string, input: UpdatePromptTemplateRequestBody): PromptTemplateSnapshot {
    const existing = this.requireById(promptId);
    const updatedAt = new Date().toISOString();
    this.#database.connection
      .prepare(`
        UPDATE prompt_templates
        SET name = ?, category = ?, note = ?, content = ?, variables_json = ?,
            favorite = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `)
      .run(
        input.name ?? existing.name,
        input.category ?? existing.category,
        input.note === undefined ? existing.note : input.note,
        input.content ?? existing.content,
        JSON.stringify(input.variables === undefined ? existing.variables : normalizeVariables(input.variables)),
        (input.favorite ?? existing.favorite) ? 1 : 0,
        updatedAt,
        promptId
      );
    return this.requireById(promptId);
  }

  softDelete(promptId: string): PromptTemplateSnapshot {
    const existing = this.requireById(promptId);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare("UPDATE prompt_templates SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, promptId);
    return { ...existing, deletedAt: now, updatedAt: now };
  }
}

function mapPrompt(row: PromptTemplateRow): PromptTemplateSnapshot {
  const variables = row.variables_json === null ? [] : JSON.parse(row.variables_json) as unknown;
  if (!Array.isArray(variables) || variables.some((value) => typeof value !== "string")) {
    throw new Error(`Prompt template variables are invalid: ${row.id}`);
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    note: row.note,
    content: row.content,
    variables,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function normalizeVariables(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
