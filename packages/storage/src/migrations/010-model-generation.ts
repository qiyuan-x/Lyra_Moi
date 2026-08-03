import type { DatabaseMigration } from "../migration-runner.js";

export const modelGenerationMigration: DatabaseMigration = {
  version: 10,
  name: "model_generation",
  sql: `
    ALTER TABLE provider_profiles
      ADD COLUMN adapter_type TEXT NOT NULL DEFAULT '';

    ALTER TABLE provider_profiles
      ADD COLUMN secondary_api_key_env TEXT;

    ALTER TABLE provider_profiles
      ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(settings_json));

    UPDATE provider_profiles
    SET adapter_type = protocol
    WHERE adapter_type = '';

    ALTER TABLE jobs
      ADD COLUMN external_task_id TEXT;

    ALTER TABLE jobs
      ADD COLUMN progress INTEGER NOT NULL DEFAULT 0
        CHECK (progress >= 0 AND progress <= 100);

    ALTER TABLE jobs
      ADD COLUMN provider_state_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(provider_state_json));

    CREATE INDEX jobs_external_task_idx
      ON jobs(provider_profile_id, external_task_id)
      WHERE external_task_id IS NOT NULL;

    ALTER TABLE worker_instances RENAME TO worker_instances_v9;

    CREATE TABLE worker_instances (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('combined', 'agent', 'image', 'model')),
      version TEXT NOT NULL,
      pid INTEGER CHECK (pid IS NULL OR pid > 0),
      started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      stopped_at TEXT
    ) STRICT;

    INSERT INTO worker_instances (
      id, kind, version, pid, started_at, heartbeat_at, stopped_at
    )
    SELECT id, kind, version, pid, started_at, heartbeat_at, stopped_at
    FROM worker_instances_v9;

    DROP TABLE worker_instances_v9;

    CREATE INDEX worker_instances_heartbeat_idx
      ON worker_instances(heartbeat_at DESC);
  `
};
