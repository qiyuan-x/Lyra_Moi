import {
  isRecord,
  matchPath,
  readJsonBody,
  requireService,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

export const handleProjectConversationRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    if (request.method === "GET" && url.pathname === "/api/v1/projects") {
      writeJson(
        response,
        200,
        { items: requireService(options.workspace, "Workspace").listProjects() },
        requestId
      );
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/v1/projects") {
      writeJson(
        response,
        201,
        {
          project: requireService(options.workspace, "Workspace").createProject(
            await readJsonBody(request, options.maxJsonBodyBytes)
          )
        },
        requestId
      );
      return true;
    }

    const project = matchPath(
      url.pathname,
      /^\/api\/v1\/projects\/([^/]+)$/u
    );
    if (request.method === "PATCH" && project) {
      writeJson(
        response,
        200,
        {
          project: requireService(options.workspace, "Workspace").updateProject(
            project[0]!,
            await readJsonBody(request, options.maxJsonBodyBytes)
          )
        },
        requestId
      );
      return true;
    }
    if (request.method === "DELETE" && project) {
      writeJson(
        response,
        200,
        {
          project: requireService(options.workspace, "Workspace")
            .deleteProject(project[0]!)
        },
        requestId
      );
      return true;
    }

    const projectConversations = matchPath(
      url.pathname,
      /^\/api\/v1\/projects\/([^/]+)\/conversations$/u
    );
    if (projectConversations) {
      const conversations = requireService(
        options.conversations,
        "Conversation"
      );
      if (request.method === "GET") {
        writeJson(
          response,
          200,
          {
            items: conversations.listConversations(projectConversations[0]!)
          },
          requestId
        );
        return true;
      }
      if (request.method === "POST") {
        const body = await readJsonBody(request, options.maxJsonBodyBytes);
        const title =
          isRecord(body) && typeof body.title === "string"
            ? body.title
            : "";
        writeJson(
          response,
          201,
          {
            conversation: conversations.createConversation(
              projectConversations[0]!,
              title
            )
          },
          requestId
        );
        return true;
      }
    }

    const conversation = matchPath(
      url.pathname,
      /^\/api\/v1\/conversations\/([^/]+)$/u
    );
    if (conversation) {
      const conversations = requireService(
        options.conversations,
        "Conversation"
      );
      if (request.method === "PATCH") {
        const body = await readJsonBody(request, options.maxJsonBodyBytes);
        if (!isRecord(body) || typeof body.title !== "string") {
          throw new Error("Conversation title is required.");
        }
        writeJson(
          response,
          200,
          {
            conversation: conversations.updateConversationTitle(
              conversation[0]!,
              body.title
            )
          },
          requestId
        );
        return true;
      }
      if (request.method === "DELETE") {
        writeJson(
          response,
          200,
          {
            conversation: conversations.deleteConversation(conversation[0]!)
          },
          requestId
        );
        return true;
      }
    }

    const conversationMessages = matchPath(
      url.pathname,
      /^\/api\/v1\/conversations\/([^/]+)\/messages$/u
    );
    if (conversationMessages) {
      const conversations = requireService(
        options.conversations,
        "Conversation"
      );
      if (request.method === "GET") {
        writeJson(
          response,
          200,
          { items: conversations.listMessages(conversationMessages[0]!) },
          requestId
        );
        return true;
      }
      if (request.method === "POST") {
        const result = conversations.sendMessage(
          conversationMessages[0]!,
          await readJsonBody(request, options.maxJsonBodyBytes)
        );
        writeJson(response, 202, result, requestId);
        return true;
      }
    }

    const conversationRuns = matchPath(
      url.pathname,
      /^\/api\/v1\/conversations\/([^/]+)\/agent-runs$/u
    );
    if (request.method === "GET" && conversationRuns) {
      writeJson(
        response,
        200,
        {
          items: requireService(options.workspace, "Workspace")
            .listAgentRuns(conversationRuns[0]!)
        },
        requestId
      );
      return true;
    }

    const agentRun = matchPath(
      url.pathname,
      /^\/api\/v1\/agent-runs\/([^/]+)$/u
    );
    if (request.method === "GET" && agentRun) {
      writeJson(
        response,
        200,
        {
          agentRun: requireService(options.workspace, "Workspace")
            .getAgentRun(agentRun[0]!)
        },
        requestId
      );
      return true;
    }

    const agentSteps = matchPath(
      url.pathname,
      /^\/api\/v1\/agent-runs\/([^/]+)\/steps$/u
    );
    if (request.method === "GET" && agentSteps) {
      writeJson(
        response,
        200,
        {
          items: requireService(options.workspace, "Workspace")
            .listPublicAgentSteps(agentSteps[0]!)
        },
        requestId
      );
      return true;
    }

    const agentCancel = matchPath(
      url.pathname,
      /^\/api\/v1\/agent-runs\/([^/]+)\/cancel$/u
    );
    if (request.method === "POST" && agentCancel) {
      const body = await readJsonBody(
        request,
        options.maxJsonBodyBytes,
        true
      );
      const cancelChildJobs =
        !isRecord(body) ||
        body.cancelChildJobs !== false;
      writeJson(
        response,
        202,
        {
          agentRun: requireService(options.workspace, "Workspace")
            .cancelAgentRun(agentCancel[0]!, cancelChildJobs)
        },
        requestId
      );
      return true;
    }

    const agentInput = matchPath(
      url.pathname,
      /^\/api\/v1\/agent-runs\/([^/]+)\/input$/u
    );
    if (request.method === "POST" && agentInput) {
      const result = requireService(
        options.conversations,
        "Conversation"
      ).submitUserInput(
        agentInput[0]!,
        await readJsonBody(request, options.maxJsonBodyBytes)
      );
      writeJson(response, 202, result, requestId);
      return true;
    }

    return false;
  };
