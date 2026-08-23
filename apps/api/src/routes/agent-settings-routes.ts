import {
  readJsonBody,
  requireService,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

const PROMPT_ROUTE = "/api/v1/settings/agent-prompts";
const RUNTIME_ROUTE = "/api/v1/settings/agent-runtime";

export const handleAgentSettingsRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    if (url.pathname !== PROMPT_ROUTE && url.pathname !== RUNTIME_ROUTE) {
      return false;
    }
    const service = requireService(
      url.pathname === PROMPT_ROUTE
        ? options.agentPromptSettings
        : options.agentRuntimeSettings,
      url.pathname === PROMPT_ROUTE
        ? "Agent prompt settings"
        : "Agent runtime settings"
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
