import type { DatabaseMigration } from "../migration-runner.js";

export const providerProfileScopeMigration: DatabaseMigration = {
  version: 6,
  name: "provider_profile_scope",
  sql: `
    ALTER TABLE provider_profiles
      ADD COLUMN service_type TEXT NOT NULL DEFAULT 'llm'
        CHECK (service_type IN ('llm', 'image', 'model'));

    UPDATE provider_profiles
    SET service_type = COALESCE(
      (
        SELECT model.service_type
        FROM provider_models AS model
        WHERE model.provider_profile_id = provider_profiles.id
          AND model.deleted_at IS NULL
        ORDER BY
          CASE model.service_type
            WHEN 'llm' THEN 1
            WHEN 'image' THEN 2
            ELSE 3
          END,
          model.created_at,
          model.id
        LIMIT 1
      ),
      'llm'
    );

    UPDATE provider_profiles
    SET base_url = rtrim(base_url, '/') || '/v1',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE protocol = 'openai-compatible'
      AND service_type != 'model'
      AND (
        length(rtrim(base_url, '/')) -
        length(replace(rtrim(base_url, '/'), '/', ''))
      ) = 2;

    UPDATE provider_models
    SET enabled = 0,
        is_default = 0,
        deleted_at = COALESCE(
          deleted_at,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE service_type != (
      SELECT profile.service_type
      FROM provider_profiles AS profile
      WHERE profile.id = provider_models.provider_profile_id
    );

    DELETE FROM app_settings
    WHERE key IN (
      'default_llm_model_id',
      'default_image_model_id',
      'default_model_provider_model_id'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM provider_models AS model
        INNER JOIN provider_profiles AS profile
          ON profile.id = model.provider_profile_id
        WHERE model.id = json_extract(app_settings.value_json, '$')
          AND model.deleted_at IS NULL
          AND model.enabled = 1
          AND profile.deleted_at IS NULL
          AND profile.enabled = 1
          AND model.service_type = profile.service_type
      );
  `
};
