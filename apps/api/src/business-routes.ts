import type { IncomingMessage, ServerResponse } from "node:http";
import type { CreateApiServerOptions } from "./api-types.js";
import { handleAgentSettingsRoutes } from "./routes/agent-settings-routes.js";
import { handleApplicationUpdateRoutes } from "./routes/application-update-routes.js";
import { handleAssetPromptRoutes } from "./routes/asset-prompt-routes.js";
import { handleCommunitySettingsRoutes } from "./routes/community-settings-routes.js";
import type {
  BusinessRouteContext,
  BusinessRouteHandler
} from "./routes/business-route-types.js";
import { handleJobGenerationRoutes } from "./routes/job-generation-routes.js";
import { handleProjectConversationRoutes } from "./routes/project-conversation-routes.js";
import { handleProviderRoutes } from "./routes/provider-routes.js";

const businessRouteHandlers: BusinessRouteHandler[] = [
  handleApplicationUpdateRoutes,
  handleAgentSettingsRoutes,
  handleCommunitySettingsRoutes,
  handleProjectConversationRoutes,
  handleJobGenerationRoutes,
  handleAssetPromptRoutes,
  handleProviderRoutes
];

export async function handleBusinessRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: CreateApiServerOptions,
  requestId: string
): Promise<boolean> {
  const context: BusinessRouteContext = {
    request,
    response,
    url,
    options,
    requestId
  };
  for (const handler of businessRouteHandlers) {
    if (await handler(context)) return true;
  }
  return false;
}
