import type {
  AgentPromptSettingsSnapshot,
  AgentRunSnapshot,
  AgentStepSnapshot,
  ApplicationDefaultModels,
  AssetListQuery,
  AssetSnapshot,
  ConversationSnapshot,
  CreatePromptTemplateRequestBody,
  CreateProviderModelRequestBody,
  CreateProviderProfileRequestBody,
  CursorPage,
  DiscoveredProviderModel,
  JobSnapshot,
  ManualGenerationRequestBody,
  ManualModelGenerationRequestBody,
  MessageSnapshot,
  OrderedAssetInput,
  ProjectSnapshot,
  PromptTemplateListQuery,
  PromptTemplateSnapshot,
  ProviderConnectionTestResult,
  ProviderModelSnapshot,
  ProviderProfileSnapshot,
  ResumeAgentUserInputRequestBody,
  SendAgentMessageRequestBody,
  UpdatePromptTemplateRequestBody,
  UpdateAgentPromptSettingsRequestBody,
  UpdateProviderModelRequestBody,
  UpdateProviderProfileRequestBody
} from "@lyra/contracts";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/u, "") ?? "";
const ACCESS_TOKEN_KEY = "lyra.accessToken";

export interface ProviderCatalog {
  profiles: ProviderProfileSnapshot[];
  models: ProviderModelSnapshot[];
  defaults: ApplicationDefaultModels;
}

export class ApiClient {
  getAgentPromptSettings(): Promise<AgentPromptSettingsSnapshot> {
    return request<AgentPromptSettingsSnapshot>(
      "/api/v1/settings/agent-prompts"
    );
  }

  updateAgentPromptSettings(
    body: UpdateAgentPromptSettingsRequestBody
  ): Promise<AgentPromptSettingsSnapshot> {
    return request<AgentPromptSettingsSnapshot>(
      "/api/v1/settings/agent-prompts",
      { method: "PATCH", json: body }
    );
  }

  resetAgentPromptSettings(): Promise<AgentPromptSettingsSnapshot> {
    return request<AgentPromptSettingsSnapshot>(
      "/api/v1/settings/agent-prompts",
      { method: "DELETE" }
    );
  }

  listProjects(): Promise<ProjectSnapshot[]> {
    return request<{ items: ProjectSnapshot[] }>("/api/v1/projects").then((value) => value.items);
  }

  createProject(body: { name: string; description?: string }): Promise<ProjectSnapshot> {
    return request<{ project: ProjectSnapshot }>("/api/v1/projects", {
      method: "POST",
      json: body
    }).then((value) => value.project);
  }

  updateProject(projectId: string, body: { name?: string; description?: string }): Promise<ProjectSnapshot> {
    return request<{ project: ProjectSnapshot }>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      json: body
    }).then((value) => value.project);
  }

  archiveProject(projectId: string): Promise<ProjectSnapshot> {
    return request<{ project: ProjectSnapshot }>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE"
    }).then((value) => value.project);
  }

  updateProjectImageMode(projectId: string, lastImageMode: "agent" | "manual"): Promise<ProjectSnapshot> {
    return request<{ project: ProjectSnapshot }>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      json: { lastImageMode }
    }).then((value) => value.project);
  }

  listProviders(): Promise<ProviderCatalog> {
    return request<ProviderCatalog>("/api/v1/providers");
  }

  createProvider(body: CreateProviderProfileRequestBody): Promise<ProviderProfileSnapshot> {
    return request<{ profile: ProviderProfileSnapshot }>("/api/v1/providers", {
      method: "POST",
      json: body
    }).then((value) => value.profile);
  }

  updateProvider(profileId: string, body: UpdateProviderProfileRequestBody): Promise<ProviderProfileSnapshot> {
    return request<{ profile: ProviderProfileSnapshot }>(`/api/v1/providers/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      json: body
    }).then((value) => value.profile);
  }

  deleteProvider(profileId: string): Promise<void> {
    return request(`/api/v1/providers/${encodeURIComponent(profileId)}`, { method: "DELETE" }).then(() => undefined);
  }

  createProviderModel(profileId: string, body: CreateProviderModelRequestBody): Promise<ProviderModelSnapshot> {
    return request<{ model: ProviderModelSnapshot }>(`/api/v1/providers/${encodeURIComponent(profileId)}/models`, {
      method: "POST",
      json: body
    }).then((value) => value.model);
  }

  updateProviderModel(modelId: string, body: UpdateProviderModelRequestBody): Promise<ProviderModelSnapshot> {
    return request<{ model: ProviderModelSnapshot }>(`/api/v1/provider-models/${encodeURIComponent(modelId)}`, {
      method: "PATCH",
      json: body
    }).then((value) => value.model);
  }

  deleteProviderModel(modelId: string): Promise<void> {
    return request(`/api/v1/provider-models/${encodeURIComponent(modelId)}`, { method: "DELETE" }).then(() => undefined);
  }

  discoverProviderModels(profileId: string): Promise<DiscoveredProviderModel[]> {
    return request<{ items: DiscoveredProviderModel[] }>(`/api/v1/providers/${encodeURIComponent(profileId)}/discover`, {
      method: "POST"
    }).then((value) => value.items);
  }

  testProvider(profileId: string): Promise<ProviderConnectionTestResult> {
    return request<{ result: ProviderConnectionTestResult }>(`/api/v1/providers/${encodeURIComponent(profileId)}/test`, {
      method: "POST"
    }).then((value) => value.result);
  }

  setDefaultModel(serviceType: "llm" | "image" | "model", modelId: string | null): Promise<ApplicationDefaultModels> {
    return request<{ defaults: ApplicationDefaultModels }>(`/api/v1/default-models/${serviceType}`, {
      method: "PUT",
      json: { modelId }
    }).then((value) => value.defaults);
  }

  listAssetsPage(projectId: string, query: AssetListQuery = {}): Promise<CursorPage<AssetSnapshot>> {
    const search = new URLSearchParams({ limit: String(query.limit ?? 100), kind: query.kind ?? "image" });
    if (query.cursor) search.set("cursor", query.cursor);
    if (query.search) search.set("search", query.search);
    if (query.tag) search.set("tag", query.tag);
    if (query.source) search.set("source", query.source);
    return request<CursorPage<AssetSnapshot>>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/assets?${search.toString()}`
    );
  }

  listAssets(projectId: string, query: AssetListQuery = {}): Promise<AssetSnapshot[]> {
    return this.listAssetsPage(projectId, query).then((value) => value.items);
  }

  async listAllAssets(projectId: string, query: AssetListQuery = {}): Promise<AssetSnapshot[]> {
    const items: AssetSnapshot[] = [];
    let cursor = query.cursor;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.listAssetsPage(projectId, {
        ...query,
        ...(cursor ? { cursor } : {})
      });
      items.push(...result.items);
      if (!result.nextCursor) return items;
      cursor = result.nextCursor;
    }
    throw new Error("Asset pagination exceeded the safety limit.");
  }

  async uploadAsset(projectId: string, file: File): Promise<AssetSnapshot> {
    const body = new FormData();
    body.append("file", file, file.name);
    return request<{ asset: AssetSnapshot }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/assets`,
      { method: "POST", body }
    ).then((value) => value.asset);
  }

  assetContentUrl(assetId: string): string {
    return appendAccessToken(`${API_BASE}/api/v1/assets/${encodeURIComponent(assetId)}/content`);
  }

  assetThumbnailUrl(assetId: string): string {
    return appendAccessToken(`${API_BASE}/api/v1/assets/${encodeURIComponent(assetId)}/thumbnail`);
  }

  getAsset(assetId: string): Promise<AssetSnapshot> {
    return request<{ asset: AssetSnapshot }>(`/api/v1/assets/${encodeURIComponent(assetId)}`)
      .then((value) => value.asset);
  }

  updateAsset(assetId: string, body: { name?: string; tags?: string[] }): Promise<AssetSnapshot> {
    return request<{ asset: AssetSnapshot }>(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      json: body
    }).then((value) => value.asset);
  }

  deleteAsset(assetId: string): Promise<AssetSnapshot> {
    return request<{ asset: AssetSnapshot }>(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE"
    }).then((value) => value.asset);
  }

  listPrompts(query: PromptTemplateListQuery = {}): Promise<PromptTemplateSnapshot[]> {
    const search = new URLSearchParams();
    if (query.search) search.set("search", query.search);
    if (query.category) search.set("category", query.category);
    if (query.favorite !== undefined) search.set("favorite", String(query.favorite));
    const suffix = search.size ? `?${search.toString()}` : "";
    return request<{ items: PromptTemplateSnapshot[] }>(
      `/api/v1/prompts${suffix}`
    ).then((value) => value.items);
  }

  createPrompt(body: CreatePromptTemplateRequestBody): Promise<PromptTemplateSnapshot> {
    return request<{ prompt: PromptTemplateSnapshot }>(
      "/api/v1/prompts",
      { method: "POST", json: body }
    ).then((value) => value.prompt);
  }

  updatePrompt(promptId: string, body: UpdatePromptTemplateRequestBody): Promise<PromptTemplateSnapshot> {
    return request<{ prompt: PromptTemplateSnapshot }>(`/api/v1/prompts/${encodeURIComponent(promptId)}`, {
      method: "PATCH",
      json: body
    }).then((value) => value.prompt);
  }

  deletePrompt(promptId: string): Promise<PromptTemplateSnapshot> {
    return request<{ prompt: PromptTemplateSnapshot }>(`/api/v1/prompts/${encodeURIComponent(promptId)}`, {
      method: "DELETE"
    }).then((value) => value.prompt);
  }

  listConversations(projectId: string): Promise<ConversationSnapshot[]> {
    return request<{ items: ConversationSnapshot[] }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations`
    ).then((value) => value.items);
  }

  createConversation(projectId: string): Promise<ConversationSnapshot> {
    return request<{ conversation: ConversationSnapshot }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations`,
      { method: "POST", json: { title: "" } }
    ).then((value) => value.conversation);
  }

  updateConversation(conversationId: string, title: string): Promise<ConversationSnapshot> {
    return request<{ conversation: ConversationSnapshot }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", json: { title } }
    ).then((value) => value.conversation);
  }

  deleteConversation(conversationId: string): Promise<ConversationSnapshot> {
    return request<{ conversation: ConversationSnapshot }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE" }
    ).then((value) => value.conversation);
  }

  listMessages(conversationId: string): Promise<MessageSnapshot[]> {
    return request<{ items: MessageSnapshot[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`
    ).then((value) => value.items);
  }

  listAgentRuns(conversationId: string): Promise<AgentRunSnapshot[]> {
    return request<{ items: AgentRunSnapshot[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/agent-runs`
    ).then((value) => value.items);
  }

  listAgentSteps(agentRunId: string): Promise<AgentStepSnapshot[]> {
    return request<{ items: AgentStepSnapshot[] }>(
      `/api/v1/agent-runs/${encodeURIComponent(agentRunId)}/steps`
    ).then((value) => value.items);
  }

  sendAgentMessage(
    conversationId: string,
    body: SendAgentMessageRequestBody
  ): Promise<{ message: MessageSnapshot; agentRun: AgentRunSnapshot }> {
    return request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      json: body
    });
  }

  submitAgentInput(
    agentRunId: string,
    body: ResumeAgentUserInputRequestBody
  ): Promise<{ message: MessageSnapshot; agentRun: AgentRunSnapshot }> {
    return request(`/api/v1/agent-runs/${encodeURIComponent(agentRunId)}/input`, {
      method: "POST",
      json: body
    });
  }

  cancelAgent(agentRunId: string): Promise<AgentRunSnapshot> {
    return request<{ agentRun: AgentRunSnapshot }>(
      `/api/v1/agent-runs/${encodeURIComponent(agentRunId)}/cancel`,
      { method: "POST", json: { cancelChildJobs: true } }
    ).then((value) => value.agentRun);
  }

  createGeneration(
    projectId: string,
    body: Omit<ManualGenerationRequestBody, "projectId">
  ): Promise<JobSnapshot> {
    return request<{ job: JobSnapshot }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generations`,
      { method: "POST", json: body }
    ).then((value) => value.job);
  }

  createModelGeneration(
    projectId: string,
    body: Omit<ManualModelGenerationRequestBody, "projectId">
  ): Promise<JobSnapshot> {
    return request<{ job: JobSnapshot }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/model-generations`,
      { method: "POST", json: body }
    ).then((value) => value.job);
  }

  listJobs(projectId: string): Promise<JobSnapshot[]> {
    return request<{ items: JobSnapshot[] }>(
      `/api/v1/jobs?projectId=${encodeURIComponent(projectId)}&limit=200`
    ).then((value) => value.items);
  }

  cancelJob(jobId: string): Promise<JobSnapshot> {
    return request<{ job: JobSnapshot }>(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST"
    }).then((value) => value.job);
  }

  retryJob(
    jobId: string,
    providerSelection?: {
      providerProfileId: string;
      providerModelId: string;
    }
  ): Promise<JobSnapshot> {
    return request<{ job: JobSnapshot }>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/retry`,
      {
        method: "POST",
        ...(providerSelection ? { json: providerSelection } : {})
      }
    ).then((value) => value.job);
  }

  dismissJob(jobId: string): Promise<JobSnapshot> {
    return request<{ job: JobSnapshot }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE"
    }).then((value) => value.job);
  }

  clearFailedJobs(projectId: string): Promise<number> {
    return request<{ dismissedCount: number }>(
      `/api/v1/jobs?projectId=${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    ).then((value) => value.dismissedCount);
  }

  createEventSource(projectId: string, conversationId?: string): EventSource {
    const search = new URLSearchParams({ projectId });
    if (conversationId) search.set("conversationId", conversationId);
    const accessToken = getAccessToken();
    if (accessToken) search.set("access_token", accessToken);
    return new EventSource(`${API_BASE}/api/v1/events?${search.toString()}`);
  }
}

export function getAccessToken(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(ACCESS_TOKEN_KEY)?.trim() ?? "";
}

export function setAccessToken(value: string): void {
  if (typeof localStorage === "undefined") return;
  const normalized = value.trim();
  if (normalized) localStorage.setItem(ACCESS_TOKEN_KEY, normalized);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit;
  json?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  const accessToken = getAccessToken();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const { json: _json, ...requestInit } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    cache: "no-store",
    headers,
    ...(body === undefined ? {} : { body })
  });
  const value = await readResponse(response);
  if (!response.ok) {
    const message = isRecord(value) && isRecord(value.error) && typeof value.error.message === "string"
      ? value.error.message
      : `请求失败：HTTP ${response.status}`;
    throw new ApiClientError(message, response.status, value);
  }
  return value as T;
}

function appendAccessToken(url: string): string {
  const accessToken = getAccessToken();
  if (!accessToken) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}access_token=${encodeURIComponent(accessToken)}`;
}

async function readResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) return response.json() as Promise<unknown>;
  return response.text();
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }
}

export function toOrderedAttachments(assets: readonly AssetSnapshot[]): OrderedAssetInput[] {
  return assets.map((asset, index) => ({
    assetId: asset.id,
    position: index + 1,
    label: `图${index + 1}`
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
