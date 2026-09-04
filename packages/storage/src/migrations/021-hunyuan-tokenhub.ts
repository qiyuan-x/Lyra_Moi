import type { DatabaseMigration } from "../migration-runner.js";

export const hunyuanTokenHubMigration: DatabaseMigration = {
  version: 21,
  name: "hunyuan_tokenhub",
  sql: `
    UPDATE provider_profiles
    SET base_url = 'https://tokenhub.tencentmaas.com',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE service_type = 'model'
      AND adapter_type = 'hunyuan'
      AND lower(rtrim(base_url, '/')) = 'https://api.ai3d.cloud.tencent.com';

    UPDATE provider_profiles
    SET settings_json = json_set(
          settings_json,
          '$.__lyra.apiKeyWebsite',
          'https://console.cloud.tencent.com/tokenhub/apikey?regionId=1'
        ),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE service_type = 'model'
      AND adapter_type = 'hunyuan'
      AND lower(json_extract(settings_json, '$.__lyra.apiKeyWebsite')) IN (
        'https://console.cloud.tencent.com/ai3d/start',
        'https://buy.cloud.tencent.com/ai3d',
        'https://console.cloud.tencent.com/tokenhub/models'
      );

    UPDATE provider_models AS legacy
    SET remote_model_id = 'hy-3d-' || legacy.remote_model_id,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE legacy.remote_model_id IN ('3.0', '3.1')
      AND legacy.provider_profile_id IN (
        SELECT id
        FROM provider_profiles
        WHERE service_type = 'model'
          AND adapter_type = 'hunyuan'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM provider_models AS current
        WHERE current.provider_profile_id = legacy.provider_profile_id
          AND current.service_type = legacy.service_type
          AND current.remote_model_id = 'hy-3d-' || legacy.remote_model_id
      );
  `
};
