import {
  readJsonBody,
  requireService,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

const COMMUNITY_SETTINGS_ROUTE = "/api/v1/settings/community";

export const handleCommunitySettingsRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    if (url.pathname !== COMMUNITY_SETTINGS_ROUTE) return false;
    const service = requireService(options.communitySettings, "Community settings");

    if (request.method === "GET") {
      writeJson(response, 200, service.snapshot(), requestId);
      return true;
    }
    if (request.method === "PATCH") {
      writeJson(
        response,
        200,
        service.update(await readJsonBody(request, options.maxJsonBodyBytes)),
        requestId
      );
      return true;
    }
    return false;
  };
