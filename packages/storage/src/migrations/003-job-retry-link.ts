import type { DatabaseMigration } from "../migration-runner.js";

export const jobRetryLinkMigration: DatabaseMigration = {
  version: 3,
  name: "job_retry_link",
  sql: `
    ALTER TABLE jobs
      ADD COLUMN retry_of_job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT;

    CREATE INDEX jobs_retry_of_idx ON jobs(retry_of_job_id);
  `
};
