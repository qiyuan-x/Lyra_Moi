import type { DatabaseMigration } from "../migration-runner.js";

export const agentImagePromptModeMigration: DatabaseMigration = {
  version: 8,
  name: "agent_image_prompt_mode",
  sql: `
    ALTER TABLE agent_runs
    ADD COLUMN optimize_image_prompt INTEGER NOT NULL DEFAULT 1
      CHECK (optimize_image_prompt IN (0, 1));
  `
};
