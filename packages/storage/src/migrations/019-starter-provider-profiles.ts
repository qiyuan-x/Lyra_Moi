import type { DatabaseMigration } from "../migration-runner.js";

export const starterProviderProfilesMigration: DatabaseMigration = {
  version: 19,
  name: "starter_provider_profiles",
  sql: `
    WITH starter_profiles (
      id, service_type, name, protocol, adapter_type, base_url,
      api_key_env, settings_json, provider_kind
    ) AS (
      VALUES
        (
          'starter-llm-openai', 'llm', 'OpenAI', 'openai', 'openai',
          'https://api.openai.com/v1', 'LYRA_PROVIDER_STARTER_LLM_OPENAI_API_KEY',
          '{"__lyra":{"providerKind":"openai","starter":true}}', 'openai'
        ),
        (
          'starter-llm-gemini', 'llm', 'Gemini', 'gemini', 'gemini',
          'https://generativelanguage.googleapis.com/v1beta',
          'LYRA_PROVIDER_STARTER_LLM_GEMINI_API_KEY',
          '{"__lyra":{"providerKind":"gemini","starter":true}}', 'gemini'
        ),
        (
          'starter-llm-frostapi', 'llm', 'FrostAPI', 'openai-compatible',
          'openai-compatible', 'https://api.linfrsot.cloud/v1',
          'LYRA_PROVIDER_STARTER_LLM_FROSTAPI_API_KEY',
          '{"__lyra":{"providerKind":"frostapi","starter":true}}', 'frostapi'
        ),
        (
          'starter-image-openai', 'image', 'OpenAI 图像', 'openai', 'openai',
          'https://api.openai.com/v1', 'LYRA_PROVIDER_STARTER_IMAGE_OPENAI_API_KEY',
          '{"__lyra":{"providerKind":"gpt-image","starter":true}}', 'gpt-image'
        ),
        (
          'starter-image-gemini', 'image', 'Gemini 图像', 'gemini', 'gemini',
          'https://generativelanguage.googleapis.com/v1beta',
          'LYRA_PROVIDER_STARTER_IMAGE_GEMINI_API_KEY',
          '{"__lyra":{"providerKind":"gemini-image","starter":true}}', 'gemini-image'
        ),
        (
          'starter-image-frostapi', 'image', 'FrostAPI 图像', 'openai-compatible',
          'openai-compatible', 'https://api.linfrsot.cloud/v1',
          'LYRA_PROVIDER_STARTER_IMAGE_FROSTAPI_API_KEY',
          '{"__lyra":{"providerKind":"frostapi","starter":true}}', 'frostapi'
        ),
        (
          'starter-model-frostapi', 'model', 'FrostAPI 3D', 'openai-compatible',
          'frostapi-3d', 'https://api.linfrsot.cloud',
          'LYRA_PROVIDER_STARTER_MODEL_FROSTAPI_API_KEY',
          '{"__lyra":{"providerKind":"frostapi","starter":true}}', 'frostapi'
        )
    )
    INSERT INTO provider_profiles (
      id, service_type, name, protocol, adapter_type, base_url, api_key_env,
      secondary_api_key_env, settings_json, enabled, created_at, updated_at, deleted_at
    )
    SELECT
      starter.id,
      starter.service_type,
      starter.name,
      starter.protocol,
      starter.adapter_type,
      starter.base_url,
      starter.api_key_env,
      NULL,
      starter.settings_json,
      0,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      NULL
    FROM starter_profiles AS starter
    WHERE NOT EXISTS (
      SELECT 1
      FROM provider_profiles AS existing
      WHERE existing.service_type = starter.service_type
        AND (
          json_extract(existing.settings_json, '$.__lyra.providerKind') = starter.provider_kind
          OR (starter.provider_kind IN ('openai', 'gpt-image') AND existing.protocol = 'openai')
          OR (starter.provider_kind IN ('gemini', 'gemini-image') AND existing.protocol = 'gemini')
          OR (
            starter.provider_kind = 'frostapi'
            AND (
              lower(existing.name) LIKE '%frost%'
              OR lower(rtrim(existing.base_url, '/')) IN (
                'https://api.linfrsot.cloud',
                'https://api.linfrsot.cloud/v1'
              )
            )
          )
        )
    );
  `
};
