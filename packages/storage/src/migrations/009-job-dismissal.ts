import type { DatabaseMigration } from "../migration-runner.js";

export const jobDismissalMigration: DatabaseMigration = {
  version: 9,
  name: "job_dismissal",
  sql: `
    ALTER TABLE jobs
      ADD COLUMN dismissed_at TEXT;

    CREATE INDEX jobs_project_dismissed_idx
      ON jobs(project_id, dismissed_at, created_at DESC);
  `
};
