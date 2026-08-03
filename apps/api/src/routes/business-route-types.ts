import type { IncomingMessage, ServerResponse } from "node:http";
import type { CreateApiServerOptions } from "../api-types.js";

export interface BusinessRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  options: CreateApiServerOptions;
  requestId: string;
}

export type BusinessRouteHandler = (
  context: BusinessRouteContext
) => Promise<boolean>;
