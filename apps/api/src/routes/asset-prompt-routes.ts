import {
  headerValue,
  matchPath,
  parseAssetQuery,
  parsePromptQuery,
  parseUploadTags,
  readJsonBody,
  readMultipartForm,
  requireService,
  writeBinary,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

export const handleAssetPromptRoutes: BusinessRouteHandler =
  async ({ request, response, url, options, requestId }) => {
    const projectAssets = matchPath(
      url.pathname,
      /^\/api\/v1\/projects\/([^/]+)\/assets$/u
    );
    if (projectAssets) {
      const assets = requireService(options.assets, "Asset");
      if (request.method === "GET") {
        const page = assets.listAssets(
          projectAssets[0]!,
          parseAssetQuery(url)
        );
        writeJson(response, 200, page, requestId);
        return true;
      }
      if (request.method === "POST") {
        const form = await readMultipartForm(
          request,
          options.maxAssetBodyBytes
        );
        const file = form.get("file");
        if (
          !(file instanceof Blob) ||
          !("name" in file) ||
          typeof file.name !== "string"
        ) {
          throw new Error("Image file is required.");
        }
        const nameValue = form.get("name");
        const tagsValue = form.get("tags");
        const asset = await assets.uploadImage({
          projectId: projectAssets[0]!,
          originalName: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
          claimedMimeType: file.type,
          ...(typeof nameValue === "string" && nameValue.trim()
            ? { name: nameValue }
            : {}),
          ...(typeof tagsValue === "string" && tagsValue.trim()
            ? { tags: parseUploadTags(tagsValue) }
            : {})
        });
        writeJson(response, 201, { asset }, requestId);
        return true;
      }
    }

    const assetContent = matchPath(
      url.pathname,
      /^\/api\/v1\/assets\/([^/]+)\/(content|thumbnail)$/u
    );
    if (request.method === "GET" && assetContent) {
      const assets = requireService(options.assets, "Asset");
      if (assetContent[1] === "content") {
        const content = await assets.getContent(assetContent[0]!);
        if (
          headerValue(request.headers["if-none-match"]) ===
          content.descriptor.etag
        ) {
          response.writeHead(304, {
            ETag: content.descriptor.etag,
            "X-Request-ID": requestId
          });
          response.end();
        } else {
          writeBinary(
            response,
            content.data,
            content.descriptor.mimeType,
            content.descriptor.etag,
            requestId
          );
        }
      } else {
        const thumbnail = await assets.getThumbnail(assetContent[0]!);
        writeBinary(
          response,
          thumbnail.data,
          thumbnail.mimeType,
          thumbnail.etag,
          requestId
        );
      }
      return true;
    }

    const asset = matchPath(
      url.pathname,
      /^\/api\/v1\/assets\/([^/]+)$/u
    );
    if (asset) {
      const assets = requireService(options.assets, "Asset");
      if (request.method === "GET") {
        writeJson(
          response,
          200,
          { asset: assets.getAsset(asset[0]!) },
          requestId
        );
        return true;
      }
      if (request.method === "PATCH") {
        writeJson(
          response,
          200,
          {
            asset: assets.updateAsset(
              asset[0]!,
              await readJsonBody(request, options.maxJsonBodyBytes)
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
          { asset: assets.deleteAsset(asset[0]!) },
          requestId
        );
        return true;
      }
    }

    if (url.pathname === "/api/v1/prompts") {
      const prompts = requireService(
        options.prompts,
        "Prompt template"
      );
      if (request.method === "GET") {
        writeJson(
          response,
          200,
          {
            items: prompts.list(parsePromptQuery(url))
          },
          requestId
        );
        return true;
      }
      if (request.method === "POST") {
        writeJson(
          response,
          201,
          {
            prompt: prompts.create(
              await readJsonBody(request, options.maxJsonBodyBytes)
            )
          },
          requestId
        );
        return true;
      }
    }

    const promptPreview = matchPath(
      url.pathname,
      /^\/api\/v1\/prompts\/([^/]+)\/preview$/u
    );
    if (promptPreview) {
      const prompts = requireService(
        options.prompts,
        "Prompt template"
      );
      const promptId = promptPreview[0]!;
      if (request.method === "GET") {
        const preview = prompts.getPreview(promptId);
        writeBinary(
          response,
          preview.data,
          preview.mimeType,
          preview.etag,
          requestId
        );
        return true;
      }
      if (request.method === "PUT") {
        const form = await readMultipartForm(request, options.maxAssetBodyBytes);
        const file = form.get("file");
        if (!(file instanceof Blob)) throw new Error("提示词效果图文件不能为空。");
        writeJson(response, 200, {
          prompt: prompts.setPreview(
            promptId,
            new Uint8Array(await file.arrayBuffer()),
            file.type
          )
        }, requestId);
        return true;
      }
      if (request.method === "DELETE") {
        writeJson(response, 200, {
          prompt: prompts.deletePreview(promptId)
        }, requestId);
        return true;
      }
    }

    const prompt = matchPath(
      url.pathname,
      /^\/api\/v1\/prompts\/([^/]+)$/u
    );
    if (prompt) {
      const prompts = requireService(
        options.prompts,
        "Prompt template"
      );
      if (request.method === "PATCH") {
        writeJson(
          response,
          200,
          {
            prompt: prompts.update(
              prompt[0]!,
              await readJsonBody(request, options.maxJsonBodyBytes)
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
          { prompt: prompts.delete(prompt[0]!) },
          requestId
        );
        return true;
      }
    }

    return false;
  };
