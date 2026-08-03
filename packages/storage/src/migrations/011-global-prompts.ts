import type { DatabaseMigration } from "../migration-runner.js";

export const globalPromptsMigration: DatabaseMigration = {
  version: 11,
  name: "global_prompts",
  sql: `
    ALTER TABLE prompt_templates RENAME TO prompt_templates_v10;

    CREATE TABLE prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      note TEXT,
      content TEXT NOT NULL,
      variables_json TEXT
        CHECK (variables_json IS NULL OR json_valid(variables_json)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    ) STRICT;

    INSERT INTO prompt_templates (
      id, name, category, note, content, variables_json,
      favorite, created_at, updated_at, deleted_at
    )
    SELECT
      source.id, source.name, source.category, source.shortcut,
      source.content, source.variables_json, source.favorite,
      source.created_at, source.updated_at, source.deleted_at
    FROM prompt_templates_v10 AS source
    WHERE source.deleted_at IS NOT NULL
       OR source.id = (
         SELECT candidate.id
         FROM prompt_templates_v10 AS candidate
         WHERE candidate.deleted_at IS NULL
           AND candidate.name = source.name
           AND candidate.category = source.category
           AND candidate.shortcut IS source.shortcut
           AND candidate.content = source.content
           AND candidate.variables_json IS source.variables_json
           AND candidate.favorite = source.favorite
         ORDER BY candidate.updated_at DESC, candidate.id
         LIMIT 1
       );

    DROP TABLE prompt_templates_v10;

    CREATE INDEX prompt_templates_updated_idx
      ON prompt_templates(updated_at DESC);
  `
};
