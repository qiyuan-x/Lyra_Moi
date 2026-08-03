import type { DatabaseMigration } from "../migration-runner.js";

export const exclusiveProviderProfileMigration: DatabaseMigration = {
  version: 7,
  name: "exclusive_provider_profile",
  sql: `
    UPDATE provider_profiles
    SET enabled = 0,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE enabled = 1
      AND deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM provider_profiles AS newer
        WHERE newer.service_type = provider_profiles.service_type
          AND newer.enabled = 1
          AND newer.deleted_at IS NULL
          AND (
            newer.updated_at > provider_profiles.updated_at
            OR (
              newer.updated_at = provider_profiles.updated_at
              AND newer.id > provider_profiles.id
            )
          )
      );

    CREATE UNIQUE INDEX provider_profiles_one_enabled_per_service_idx
      ON provider_profiles(service_type)
      WHERE enabled = 1 AND deleted_at IS NULL;

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
      );
  `
};
