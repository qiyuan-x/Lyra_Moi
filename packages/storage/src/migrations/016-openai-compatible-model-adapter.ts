import type { DatabaseMigration } from "../migration-runner.js";

export const openAiCompatibleModelAdapterMigration: DatabaseMigration = {
  version: 16,
  name: "openai_compatible_model_adapter",
  sql: `
    UPDATE provider_profiles
    SET adapter_type = 'openai-compatible',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE service_type = 'model'
      AND adapter_type = 'frost-model';
  `
};
