import type { DatabaseMigration } from "../migration-runner.js";

export const promptTemplatePreviewsMigration: DatabaseMigration = {
  version: 18,
  name: "prompt_template_previews",
  sql: `
    ALTER TABLE prompt_templates ADD COLUMN preview_mime_type TEXT;
  `
};
