import type { DatabaseMigration } from "../migration-runner.js";

export const providerDefaultsMigration: DatabaseMigration = {
  version: 5,
  name: "provider_defaults",
  sql: `
    UPDATE provider_profiles
    SET protocol = 'openai-compatible',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE protocol = 'openai'
      AND deleted_at IS NULL
      AND (
        lower(trim(name)) = 'deepseek'
        OR lower(base_url) LIKE 'https://api.deepseek.com%'
      );

    INSERT INTO app_settings (key, value_json, updated_at)
    SELECT 'default_llm_model_id', json_quote(model.id),
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM provider_models AS model
    INNER JOIN provider_profiles AS profile ON profile.id = model.provider_profile_id
    WHERE model.service_type = 'llm'
      AND model.enabled = 1 AND model.deleted_at IS NULL
      AND profile.enabled = 1 AND profile.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'default_llm_model_id')
    ORDER BY model.created_at, model.id
    LIMIT 1;

    INSERT INTO app_settings (key, value_json, updated_at)
    SELECT 'default_image_model_id', json_quote(model.id),
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM provider_models AS model
    INNER JOIN provider_profiles AS profile ON profile.id = model.provider_profile_id
    WHERE model.service_type = 'image'
      AND model.enabled = 1 AND model.deleted_at IS NULL
      AND profile.enabled = 1 AND profile.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'default_image_model_id')
    ORDER BY model.created_at, model.id
    LIMIT 1;

    INSERT INTO app_settings (key, value_json, updated_at)
    SELECT 'default_model_provider_model_id', json_quote(model.id),
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM provider_models AS model
    INNER JOIN provider_profiles AS profile ON profile.id = model.provider_profile_id
    WHERE model.service_type = 'model'
      AND model.enabled = 1 AND model.deleted_at IS NULL
      AND profile.enabled = 1 AND profile.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM app_settings WHERE key = 'default_model_provider_model_id'
      )
    ORDER BY model.created_at, model.id
    LIMIT 1;
  `
};
