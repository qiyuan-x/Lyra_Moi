import { requireService, writeJson } from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

const UPDATE_ROUTE = "/api/v1/system/update";

export const handleApplicationUpdateRoutes: BusinessRouteHandler = async ({
  request,
  response,
  url,
  options,
  requestId
}) => {
  if (!url.pathname.startsWith(UPDATE_ROUTE)) return false;
  const service = requireService(options.applicationUpdates, "Application update");

  if (request.method === "GET" && url.pathname === UPDATE_ROUTE) {
    writeJson(response, 200, await service.snapshot(), requestId);
    return true;
  }
  if (request.method === "POST" && url.pathname === `${UPDATE_ROUTE}/check`) {
    writeJson(response, 200, await service.check(), requestId);
    return true;
  }
  if (request.method === "POST" && url.pathname === `${UPDATE_ROUTE}/apply`) {
    writeJson(response, 202, await service.apply(), requestId);
    return true;
  }
  return false;
};
