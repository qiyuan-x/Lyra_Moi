import type { DatabaseMigration } from "../migration-runner.js";

export const multipleEnabledProvidersMigration: DatabaseMigration = {
  version: 12,
  name: "multiple_enabled_providers",
  sql: `
    DROP INDEX IF EXISTS provider_profiles_one_enabled_per_service_idx;
  `
};
