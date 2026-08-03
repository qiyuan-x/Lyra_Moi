import type { ProviderServiceType } from "@lyra/contracts";
import {
  isProviderServiceType,
  isRecord,
  matchPath,
  readJsonBody,
  requireService,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

export const handleProviderRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    if (request.method === "GET" && url.pathname === "/api/v1/providers") {
      const providers = requireService(options.providers, "Provider");
      const profiles = await providers.listProfiles();
      const models = profiles.flatMap((profile) =>
        providers.listModels(profile.id)
      );
      writeJson(
        response,
        200,
        {
          profiles,
          models,
          defaults: providers.getApplicationDefaultModels()
        },
        requestId
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/providers") {
      const profile = await requireService(
        options.providers,
        "Provider"
      ).createProfile(
        await readJsonBody(request, options.maxJsonBodyBytes)
      );
      writeJson(response, 201, { profile }, requestId);
      return true;
    }

    const providerModels = matchPath(
      url.pathname,
      /^\/api\/v1\/providers\/([^/]+)\/models$/u
    );
    if (providerModels) {
      const providers = requireService(options.providers, "Provider");
      if (request.method === "GET") {
        const rawServiceType =
          url.searchParams.get("serviceType")?.trim();
        if (
          rawServiceType &&
          !isProviderServiceType(rawServiceType)
        ) {
          throw new Error("Provider service type is invalid.");
        }
        const serviceType: ProviderServiceType | undefined =
          rawServiceType &&
          isProviderServiceType(rawServiceType)
            ? rawServiceType
            : undefined;
        writeJson(
          response,
          200,
          {
            items: providers.listModels(
              providerModels[0]!,
              serviceType
            )
          },
          requestId
        );
        return true;
      }
      if (request.method === "POST") {
        const model = providers.createModel(
          providerModels[0]!,
          await readJsonBody(request, options.maxJsonBodyBytes)
        );
        writeJson(response, 201, { model }, requestId);
        return true;
      }
    }

    const providerAction = matchPath(
      url.pathname,
      /^\/api\/v1\/providers\/([^/]+)\/(discover|test)$/u
    );
    if (request.method === "POST" && providerAction) {
      const providers = requireService(options.providers, "Provider");
      if (providerAction[1] === "discover") {
        writeJson(
          response,
          200,
          {
            items: await providers.discoverModels(
              providerAction[0]!
            )
          },
          requestId
        );
      } else {
        writeJson(
          response,
          200,
          {
            result: await providers.testConnection(
              providerAction[0]!
            )
          },
          requestId
        );
      }
      return true;
    }

    const provider = matchPath(
      url.pathname,
      /^\/api\/v1\/providers\/([^/]+)$/u
    );
    if (provider) {
      const providers = requireService(options.providers, "Provider");
      if (request.method === "GET") {
        writeJson(
          response,
          200,
          { profile: await providers.getProfile(provider[0]!) },
          requestId
        );
        return true;
      }
      if (request.method === "PATCH") {
        writeJson(
          response,
          200,
          {
            profile: await providers.updateProfile(
              provider[0]!,
              await readJsonBody(request, options.maxJsonBodyBytes)
            )
          },
          requestId
        );
        return true;
      }
      if (request.method === "DELETE") {
        await providers.deleteProfile(provider[0]!);
        writeJson(response, 200, { deleted: true }, requestId);
        return true;
      }
    }

    const providerModel = matchPath(
      url.pathname,
      /^\/api\/v1\/provider-models\/([^/]+)$/u
    );
    if (providerModel) {
      const providers = requireService(options.providers, "Provider");
      if (request.method === "PATCH") {
        writeJson(
          response,
          200,
          {
            model: providers.updateModel(
              providerModel[0]!,
              await readJsonBody(request, options.maxJsonBodyBytes)
            )
          },
          requestId
        );
        return true;
      }
      if (request.method === "DELETE") {
        providers.deleteModel(providerModel[0]!);
        writeJson(response, 200, { deleted: true }, requestId);
        return true;
      }
    }

    const defaultModel = matchPath(
      url.pathname,
      /^\/api\/v1\/default-models\/(llm|image|model)$/u
    );
    if (request.method === "PUT" && defaultModel) {
      const body = await readJsonBody(
        request,
        options.maxJsonBodyBytes
      );
      if (
        !isRecord(body) ||
        (body.modelId !== null && typeof body.modelId !== "string")
      ) {
        throw new Error("modelId must be a string or null.");
      }
      const providers = requireService(options.providers, "Provider");
      providers.setApplicationDefaultModel(
        defaultModel[0]! as ProviderServiceType,
        body.modelId
      );
      writeJson(
        response,
        200,
        { defaults: providers.getApplicationDefaultModels() },
        requestId
      );
      return true;
    }

    return false;
  };
