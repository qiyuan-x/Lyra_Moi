import type { DatabaseMigration } from "../migration-runner.js";

/** Links delegated agent runs to their parent without changing existing run semantics. */
export const agentSubrunsMigration: DatabaseMigration = {
  version: 23,
  name: "agent-subruns",
  sql: `
      ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
      CREATE INDEX agent_runs_parent_idx ON agent_runs(parent_run_id, created_at);
    `
};
