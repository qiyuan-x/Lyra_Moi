import type { DatabaseMigration } from "../migration-runner.js";

export const frostApiModelAdapterMigration: DatabaseMigration = {
  version: 20,
  name: "frostapi_model_adapter",
  sql: `
    UPDATE provider_profiles
    SET adapter_type = 'frostapi-3d',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE service_type = 'model'
      AND adapter_type = 'openai-compatible';
  `
};
