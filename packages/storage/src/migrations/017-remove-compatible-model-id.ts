import type { DatabaseMigration } from "../migration-runner.js";

export const removeCompatibleModelIdMigration: DatabaseMigration = {
  version: 17,
  name: "remove_compatible_model_id",
  sql: `
    UPDATE provider_profiles
    SET settings_json = json_remove(settings_json, '$.modelId'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE service_type = 'model'
      AND adapter_type = 'openai-compatible'
      AND json_type(settings_json, '$.modelId') IS NOT NULL;
  `
};
