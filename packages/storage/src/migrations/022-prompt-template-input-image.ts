import type { DatabaseMigration } from "../migration-runner.js";

export const promptTemplateInputImageMigration: DatabaseMigration = {
  version: 22,
  name: "prompt_template_input_image",
  sql: `
    ALTER TABLE prompt_templates ADD COLUMN input_image_asset_id TEXT;
  `
};
