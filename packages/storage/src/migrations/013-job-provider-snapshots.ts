import type { DatabaseMigration } from "../migration-runner.js";

export const jobProviderSnapshotsMigration: DatabaseMigration = {
  version: 13,
  name: "job_provider_snapshots",
  sql: `
    ALTER TABLE jobs
      ADD COLUMN provider_name_snapshot TEXT NOT NULL DEFAULT '';
    ALTER TABLE jobs
      ADD COLUMN remote_model_id_snapshot TEXT NOT NULL DEFAULT '';

    UPDATE jobs
    SET provider_name_snapshot = COALESCE(
          (SELECT name FROM provider_profiles WHERE id = jobs.provider_profile_id),
          provider_profile_id
        ),
        remote_model_id_snapshot = COALESCE(
          (SELECT remote_model_id FROM provider_models WHERE id = jobs.provider_model_id),
          provider_model_id
        );
  `
};
