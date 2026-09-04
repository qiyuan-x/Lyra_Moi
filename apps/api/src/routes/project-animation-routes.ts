import type { ProjectAnimationClipSnapshot } from "@lyra/contracts";
import {
  headerValue,
  matchPath,
  readJsonBody,
  readMultipartForm,
  requireService,
  writeBinary,
  writeJson
} from "../http-helpers.js";
import type { BusinessRouteHandler } from "./business-route-types.js";

const defaultAnimationUploadLimit = 202 * 1024 * 1024;

export const handleProjectAnimationRoutes: BusinessRouteHandler = async ({
  request,
  response,
  url,
  options,
  requestId
}) => {
  const projectAnimations = matchPath(
    url.pathname,
    /^\/api\/v1\/projects\/([^/]+)\/animations$/u
  );
  if (projectAnimations) {
    const animations = requireService(options.projectAnimations, "Project animation");
    const projectId = projectAnimations[0]!;
    if (request.method === "GET") {
      writeJson(response, 200, { items: await animations.list(projectId) }, requestId);
      return true;
    }
    if (request.method === "POST") {
      const form = await readMultipartForm(
        request,
        options.maxAnimationBodyBytes ?? defaultAnimationUploadLimit
      );
      const file = form.get("file");
      if (!(file instanceof Blob) || !("name" in file) || typeof file.name !== "string") {
        throw new Error("UE5 animation file is required.");
      }
      const clipsValue = form.get("clips");
      if (typeof clipsValue !== "string") throw new Error("UE5 animation clips are required.");
      const nameValue = form.get("name");
      const animation = await animations.create({
        projectId,
        originalName: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
        clips: parseClips(clipsValue),
        ...(typeof nameValue === "string" && nameValue.trim() ? { name: nameValue } : {})
      });
      writeJson(response, 201, { animation }, requestId);
      return true;
    }
  }

  const animationContent = matchPath(
    url.pathname,
    /^\/api\/v1\/projects\/([^/]+)\/animations\/([^/]+)\/content$/u
  );
  if (animationContent && request.method === "GET") {
    const animations = requireService(options.projectAnimations, "Project animation");
    const content = await animations.getContent(animationContent[0]!, animationContent[1]!);
    if (headerValue(request.headers["if-none-match"]) === content.etag) {
      response.writeHead(304, { ETag: content.etag, "X-Request-ID": requestId });
      response.end();
    } else {
      writeBinary(
        response,
        content.data,
        content.animation.mimeType,
        content.etag,
        requestId
      );
    }
    return true;
  }

  const animation = matchPath(
    url.pathname,
    /^\/api\/v1\/projects\/([^/]+)\/animations\/([^/]+)$/u
  );
  if (animation) {
    const animations = requireService(options.projectAnimations, "Project animation");
    const [projectId, animationId] = animation as [string, string];
    if (request.method === "PATCH") {
      const body = await readJsonBody(request, options.maxJsonBodyBytes);
      if (!body || typeof body !== "object" || typeof (body as { name?: unknown }).name !== "string") {
        throw new Error("UE5 animation name is required.");
      }
      writeJson(response, 200, {
        animation: await animations.updateName(
          projectId,
          animationId,
          (body as { name: string }).name
        )
      }, requestId);
      return true;
    }
    if (request.method === "DELETE") {
      writeJson(response, 200, {
        animation: await animations.delete(projectId, animationId)
      }, requestId);
      return true;
    }
  }

  return false;
};

function parseClips(value: string): ProjectAnimationClipSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("UE5 animation clips are invalid.");
  }
  if (!Array.isArray(parsed)) throw new Error("UE5 animation clips are invalid.");
  return parsed.map((item) => {
    if (!item || typeof item !== "object") throw new Error("UE5 animation clips are invalid.");
    const clip = item as { name?: unknown; duration?: unknown };
    if (typeof clip.name !== "string" || typeof clip.duration !== "number") {
      throw new Error("UE5 animation clips are invalid.");
    }
    return { name: clip.name, duration: clip.duration };
  });
}
