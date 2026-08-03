import {
  isRecord,
  matchPath,
  parseJobQuery,
  readJsonBody,
  requireQueryValue,
  requireService,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

export const handleJobGenerationRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    const generation = matchPath(
      url.pathname,
      /^\/api\/v1\/projects\/([^/]+)\/generations$/u
    );
    if (request.method === "POST" && generation) {
      const job = requireService(
        options.manualGenerations,
        "Manual generation"
      ).submit(
        generation[0]!,
        await readJsonBody(request, options.maxJsonBodyBytes)
      );
      writeJson(response, 202, { job }, requestId);
      return true;
    }

    const modelGeneration = matchPath(
      url.pathname,
      /^\/api\/v1\/projects\/([^/]+)\/model-generations$/u
    );
    if (request.method === "POST" && modelGeneration) {
      const job = requireService(
        options.modelGenerations,
        "Model generation"
      ).submit(
        modelGeneration[0]!,
        await readJsonBody(request, options.maxJsonBodyBytes)
      );
      writeJson(response, 202, { job }, requestId);
      return true;
    }

    if (url.pathname === "/api/v1/jobs" && request.method === "GET") {
      const workspace = requireService(options.workspace, "Workspace");
      writeJson(
        response,
        200,
        { items: workspace.listJobs(parseJobQuery(url)) },
        requestId
      );
      return true;
    }
    if (url.pathname === "/api/v1/jobs" && request.method === "DELETE") {
      const workspace = requireService(options.workspace, "Workspace");
      const projectId = requireQueryValue(url, "projectId");
      writeJson(
        response,
        200,
        { dismissedCount: workspace.clearFailedJobs(projectId) },
        requestId
      );
      return true;
    }

    const job = matchPath(url.pathname, /^\/api\/v1\/jobs\/([^/]+)$/u);
    if (request.method === "GET" && job) {
      writeJson(
        response,
        200,
        { job: requireService(options.workspace, "Workspace").getJob(job[0]!) },
        requestId
      );
      return true;
    }
    if (request.method === "DELETE" && job) {
      writeJson(
        response,
        200,
        {
          job: requireService(options.workspace, "Workspace")
            .dismissJob(job[0]!)
        },
        requestId
      );
      return true;
    }

    const jobCancel = matchPath(
      url.pathname,
      /^\/api\/v1\/jobs\/([^/]+)\/cancel$/u
    );
    if (request.method === "POST" && jobCancel) {
      writeJson(
        response,
        202,
        {
          job: requireService(options.workspace, "Workspace")
            .cancelJob(jobCancel[0]!)
        },
        requestId
      );
      return true;
    }

    const jobRetry = matchPath(
      url.pathname,
      /^\/api\/v1\/jobs\/([^/]+)\/retry$/u
    );
    if (request.method === "POST" && jobRetry) {
      const body = await readJsonBody(
        request,
        options.maxJsonBodyBytes,
        true
      );
      let providerSelection:
        | { providerProfileId: string; providerModelId: string }
        | undefined;
      if (isRecord(body)) {
        const providerProfileId = body.providerProfileId;
        const providerModelId = body.providerModelId;
        if (providerProfileId !== undefined || providerModelId !== undefined) {
          if (
            typeof providerProfileId !== "string" ||
            !providerProfileId.trim() ||
            typeof providerModelId !== "string" ||
            !providerModelId.trim()
          ) {
            throw new Error("Retry provider selection is invalid.");
          }
          providerSelection = {
            providerProfileId: providerProfileId.trim(),
            providerModelId: providerModelId.trim()
          };
        }
      } else if (body !== undefined && body !== null) {
        throw new Error("Retry request body is invalid.");
      }
      writeJson(
        response,
        202,
        {
          job: requireService(options.workspace, "Workspace")
            .retryJob(jobRetry[0]!, providerSelection)
        },
        requestId
      );
      return true;
    }

    return false;
  };
