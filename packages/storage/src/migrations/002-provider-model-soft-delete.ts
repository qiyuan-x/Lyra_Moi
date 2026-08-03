import type { DatabaseMigration } from "../migration-runner.js";

export const providerModelSoftDeleteMigration: DatabaseMigration = {
  version: 2,
  name: "provider_model_soft_delete",
  sql: String.raw`
    ALTER TABLE provider_models ADD COLUMN deleted_at TEXT;
    CREATE INDEX provider_models_profile_active_idx
      ON provider_models(provider_profile_id, service_type, enabled)
      WHERE deleted_at IS NULL;
  `
};
