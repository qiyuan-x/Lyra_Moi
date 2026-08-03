import {
  readJsonBody,
  requireService,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

const ROUTE = "/api/v1/settings/agent-prompts";

export const handleAgentSettingsRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    if (url.pathname !== ROUTE) return false;
    const service = requireService(
      options.agentPromptSettings,
      "Agent prompt settings"
    );

    if (request.method === "GET") {
      writeJson(response, 200, service.snapshot(), requestId);
      return true;
    }

    if (request.method === "PATCH") {
      writeJson(
        response,
        200,
        service.update(
          await readJsonBody(request, options.maxJsonBodyBytes)
        ),
        requestId
      );
      return true;
    }

    if (request.method === "DELETE") {
      writeJson(response, 200, service.reset(), requestId);
      return true;
    }

    return false;
  };
