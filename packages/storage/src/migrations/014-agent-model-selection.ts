import type { DatabaseMigration } from "../migration-runner.js";

export const agentModelSelectionMigration: DatabaseMigration = {
  version: 14,
  name: "agent_model_selection",
  sql: `
    ALTER TABLE agent_runs
      ADD COLUMN default_model_profile_id TEXT
      REFERENCES provider_profiles(id) ON DELETE RESTRICT;
    ALTER TABLE agent_runs
      ADD COLUMN default_model_model_id TEXT
      REFERENCES provider_models(id) ON DELETE RESTRICT;
  `
};
