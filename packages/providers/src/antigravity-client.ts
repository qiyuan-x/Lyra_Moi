import { randomUUID } from "node:crypto";
import { ProviderHttpClient } from "./provider-http-client.js";

// Protocol reference: Sub2API antigravity/client.go and wrapV1InternalRequest.
export function isAntigravityOAuth(settings: Record<string, unknown>): boolean {
  return settings.antigravity === true && ["oauth", "token", "json"].includes(String(settings.authMode));
}

export function antigravityHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "User-Agent": "antigravity/2.9.1", Accept: "application/json" };
}

export async function antigravityProject(client: ProviderHttpClient, base: string, token: string, signal?: AbortSignal, configuredProject?: unknown): Promise<string> {
  signal?.throwIfAborted();
  if (typeof configuredProject === "string" && configuredProject.trim()) return configuredProject.trim();
  const response = await client.postJson(`${base.replace(/\/+$/u, "")}/v1internal:loadCodeAssist`, antigravityHeaders(token),
    { metadata: { ideType: "ANTIGRAVITY", ideName: "antigravity" } }, signal);
  const value = record(response).cloudaicompanionProject;
  const project = typeof value === "string" ? value : record(value).id;
  if (typeof project !== "string" || !project.trim()) throw new Error("Antigravity 账号未返回可用项目，请在供应商设置中填写 GCP Project ID，或先在官方客户端完成账号开通。");
  return project.trim();
}

export function antigravityRequest(project: string, model: string, request: unknown): Record<string, unknown> {
  return { project, model, requestId: `agent-${randomUUID()}`, userAgent: "antigravity", requestType: "agent", request };
}

export function unwrapAntigravity(value: unknown): unknown {
  return record(value).response ?? value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
