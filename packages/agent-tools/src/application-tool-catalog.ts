import { ToolCatalog, type RunContext, type RuntimeTool, type ToolContext, type ToolOutcome } from "@lyra/agent-runtime";
import { isProviderModelVisible, defaultModelParameters, type GenerationRequest } from "@lyra/contracts";
import type { AssetService, ModelGenerationService, PromptTemplateService, QueuedGenerationService, WorkspaceQueryService } from "@lyra/core";
import type { RuntimeRepositories } from "@lyra/storage";

export interface ApplicationToolServices {
  repositories: RuntimeRepositories;
  assets: AssetService;
  workspace: WorkspaceQueryService;
  prompts: PromptTemplateService;
  generations: QueuedGenerationService;
  modelGenerations: ModelGenerationService;
  perform(operationId: string, action: (stepId: string) => ToolOutcome): ToolOutcome;
  delegateSubagent?: (input: { prompt: string; parentRunId: string; context: RunContext; stepId: string; maxToolCalls?: number }) => { runId: string };
}

const text = { type: "string", minLength: 1 };
const parameters = { type: "object", additionalProperties: true };
const selection = { providerProfileId: text, providerModelId: text };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });

/** Application capabilities call the same services as manual actions, not private HTTP endpoints. */
export function createApplicationToolCatalog(services: ApplicationToolServices): ToolCatalog {
  const catalog = new ToolCatalog();
  const { repositories, assets, workspace, prompts } = services;
  const add = (name: string, description: string, policy: RuntimeTool["policy"], inputSchema: Record<string, unknown>,
    action: (value: Record<string, unknown>, context: ToolContext, stepId: string) => ToolOutcome,
    prepare?: RuntimeTool["prepare"]) => {
    catalog.register({ definition: { name, description, parameters: inputSchema }, policy, ...(prepare ? { prepare } : {}),
      async execute(value, context) {
        context.signal?.throwIfAborted();
        return policy === "read" ? action(value as Record<string, unknown>, context, "") :
          services.perform(context.operationId, (stepId) => action(value as Record<string, unknown>, context, stepId));
      }
    });
  };
  const result = (value: unknown): ToolOutcome => ({ kind: "result", value });
  const requireAsset = (id: string, context: ToolContext) => {
    const asset = assets.getAsset(id);
    if (asset.projectId !== context.context.projectId) throw new Error("素材不属于当前项目。");
    return asset;
  };
  const requireJob = (id: string, context: ToolContext) => {
    const job = workspace.getJob(id);
    if (job.projectId !== context.context.projectId) throw new Error("任务不属于当前项目。");
    return job;
  };
  add("list_app_tools", "查询应用功能目录；调用参数见请求中的工具定义，不需要重复查询。", "read", schema({}), () => result(
    catalog.definitions().map(({ name, description }) => ({ name, description }))
  ));
  add("list_projects", "列出应用项目。", "read", schema({}), () => result(workspace.listProjects()));
  add("create_project", "创建项目。", "write", schema({ name: text, description: { type: "string" } }, ["name"]), (value) => result(workspace.createProject(value)));
  add("update_project", "修改项目名称或说明。", "write", schema({ name: text, description: { type: "string" } }),
    (value, context) => result(workspace.updateProject(context.context.projectId, value)));
  add("list_conversations", "列出当前项目的对话。", "read", schema({}), (_value, context) => result(workspace.listConversations(context.context.projectId)));
  add("rename_conversation", "修改当前对话名称。", "write", schema({ title: text }, ["title"]),
    (value, context) => result(repositories.conversations.updateTitle(context.context.conversationId, String(value.title))));
  add("list_assets", "查找当前项目素材，返回真实素材 ID。", "read", schema({ search: { type: "string" }, cursor: text,
    kind: { enum: ["image", "model", "file"] }, source: { enum: ["upload", "generated"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }),
    (value, context) => result(assets.listAssets(context.context.projectId, value)));
  add("inspect_asset", "读取素材信息。图片和 PDF 会作为真实内容提供给模型；3D 文件只返回元数据，不伪称已检查外观。", "read", schema({ assetId: text }, ["assetId"]),
    (value, context) => {
      const asset = requireAsset(String(value.assetId), context);
      return { kind: "result", value: asset, ...((asset.kind === "image" || asset.mimeType === "application/pdf") ? {
        assets: [{ assetId: asset.id, label: asset.name, position: 0 }]
      } : {}) };
    });
  add("update_asset", "修改素材名称和标签。", "write", schema({ assetId: text, name: text, tags: { type: "array", items: { type: "string" }, maxItems: 50 } }, ["assetId"]),
    (value, context) => { const asset = requireAsset(String(value.assetId), context); const { assetId: _id, ...patch } = value; return result(assets.updateAsset(asset.id, patch)); });
  add("delete_asset", "删除当前项目的指定素材，需要审核。", "approval", schema({ assetId: text }, ["assetId"]),
    (value, context) => result(assets.deleteAsset(requireAsset(String(value.assetId), context).id)));
  add("list_jobs", "查看当前项目最近任务摘要；用 get_job 按 ID 获取完整参数、结果和错误。", "read", schema({
    limit: { type: "integer", minimum: 1, maximum: 100 }, conversationId: text,
    kind: { enum: ["image.generate", "model.generate"] }
  }), (value, context) => result(workspace.listJobs({ projectId: context.context.projectId,
    limit: Number(value.limit ?? 20), ...(value.conversationId ? { conversationId: String(value.conversationId) } : {}),
    ...(value.kind ? { kind: value.kind as "image.generate" | "model.generate" } : {})
  }).map((job) => ({ id: job.id, kind: job.kind, status: job.status, title: job.title.slice(0, 160),
    progress: job.progress, providerModelId: job.providerModelId, createdAt: job.createdAt,
    errorCode: job.errorCode }))));
  add("get_job", "读取指定任务的真实结果或错误。", "read", schema({ jobId: text }, ["jobId"]), (value, context) => result(requireJob(String(value.jobId), context)));
  add("cancel_job", "取消当前项目的任务。", "write", schema({ jobId: text }, ["jobId"]), (value, context) => result(workspace.cancelJob(requireJob(String(value.jobId), context).id)));
  add("retry_job", "重试失败任务，可能产生费用，必须审核。", "approval", schema({ jobId: text }, ["jobId"]), (value, context) => {
    const job = workspace.retryJob(requireJob(String(value.jobId), context).id);
    return { kind: "job", jobId: job.id };
  });
  add("dismiss_job", "从任务列表移除已结束任务。", "write", schema({ jobId: text }, ["jobId"]), (value, context) => result(workspace.dismissJob(requireJob(String(value.jobId), context).id)));
  add("list_prompt_templates", "查找应用提示词模板。", "read", schema({ search: { type: "string" } }), (value) => result(prompts.list(value)));
  add("create_prompt_template", "保存提示词模板。", "write", schema({ name: text, content: text, category: { type: "string" }, variables: { type: "array", items: text }, favorite: { type: "boolean" }, note: { type: "string" } }, ["name", "content"]), (value) => result(prompts.create(value)));
  add("update_prompt_template", "修改指定提示词模板。", "write", schema({ promptId: text, name: text, content: text, category: { type: "string" }, variables: { type: "array", items: text }, favorite: { type: "boolean" }, note: { type: "string" } }, ["promptId"]),
    (value) => { const { promptId, ...patch } = value; return result(prompts.update(String(promptId), patch)); });
  add("delete_prompt_template", "删除提示词模板，需要审核。", "approval", schema({ promptId: text }, ["promptId"]), (value) => result(prompts.delete(String(value.promptId))));
  add("list_provider_models", "分页查询已配置模型，不显示密钥。可按供应商、类型和模型名称筛选；hasMore 为 true 时增加 offset 继续查询。", "read", schema({
    profileId: text, serviceType: { enum: ["llm", "image", "model"] }, search: { type: "string" },
    offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 }
  }), (value) => {
    const offset = Number(value.offset ?? 0);
    const limit = Number(value.limit ?? 20);
    const search = String(value.search ?? "").toLowerCase();
    return result(repositories.providers.listProfiles()
      .filter((profile) => profile.enabled && (!value.profileId || profile.id === value.profileId) &&
        (!value.serviceType || profile.serviceType === value.serviceType))
      .map((profile) => {
        const defaultKey = profile.serviceType === "image" ? "default_image_model_id" :
          profile.serviceType === "llm" ? "default_llm_model_id" : "default_model_provider_model_id";
        const defaultId = repositories.settings.get(defaultKey);
        const models = repositories.providers.listModels(profile.id).filter((model) =>
          model.enabled && model.serviceType === profile.serviceType &&
          isProviderModelVisible(model, profile, typeof defaultId === "string" ? defaultId : null) &&
          `${model.id} ${model.displayName} ${model.remoteModelId}`.toLowerCase().includes(search));
        return {
          id: profile.id, name: profile.name, serviceType: profile.serviceType, enabled: profile.enabled,
          total: models.length, offset, hasMore: offset + limit < models.length,
          models: models.slice(offset, offset + limit).map((model) => ({
            id: model.id, name: model.displayName, remoteModelId: model.remoteModelId, enabled: model.enabled
          }))
        };
      }).filter((profile) => profile.total > 0));
  });
  add("request_user_input", "缺少必要信息时提问并暂停，等待用户回复。", "write", schema({ prompt: text, choices: {
    type: "array", maxItems: 10, items: schema({ id: text, label: text }, ["id", "label"])
  } }, ["prompt"]), (value) => ({ kind: "input", prompt: String(value.prompt), choices: (value.choices ?? []) as { id: string; label: string }[] }));
  add("delegate_subagent", "创建独立的子智能体处理明确的子任务，子任务完成后父任务继续。", "write",
    schema({ prompt: text, maxToolCalls: { type: "integer", minimum: 1, maximum: 30 } }, ["prompt"]),
    (value, context, stepId) => {
      if (!services.delegateSubagent) throw new Error("当前运行环境未启用子智能体调度。");
      const created = services.delegateSubagent({ prompt: String(value.prompt).trim(), parentRunId: context.runId,
        context: context.context, stepId, ...(value.maxToolCalls === undefined ? {} : { maxToolCalls: Number(value.maxToolCalls) }) });
      return { kind: "subagent", runId: created.runId };
    });
  add("generate_image", "生成或编辑图片。可按顺序指定参考素材；不指定则使用本轮参考素材。等待真实任务结果。", "write", schema({
    prompt: text, count: { type: "integer", minimum: 1, maximum: 8 }, ...selection, parameters,
    assetIds: { type: "array", maxItems: 20, items: text }
  }, ["prompt"]), (value, context, stepId) => {
    const request = value as unknown as GenerationRequest;
    for (const attachment of request.attachments) requireAsset(attachment.assetId, context);
    validateSelection(request.providerProfileId, request.providerModelId, "image", repositories);
    const job = services.generations.submit(request, { conversationId: context.context.conversationId,
      agentRunId: context.runId, agentStepId: stepId, requestMessageId: context.context.requestMessageId });
    return { kind: "job", jobId: job.id };
  }, (value, context) => {
    const input = value as Record<string, unknown>;
    const selected = resolveSelection(input, context, "image");
    return { projectId: context.projectId, prompt: context.optimizeImagePrompt ? input.prompt : context.originalPrompt,
      count: input.count ?? 1, parameters: input.parameters ?? {}, source: "agent", ...selected,
      attachments: Array.isArray(input.assetIds) ? input.assetIds.map((id, position) => ({ assetId: String(id), position, label: `参考图 ${position + 1}` })) : context.attachments };
  });
  add("generate_model", "文字、图片或多视图建模。先审核保存的参数，批准后直接提交，不需要再次调用工具。", "approval", schema({
    inputMode: { enum: ["text", "image", "multiview"] }, prompt: { ...text, description: "仅用于文生模型。图生和多视图建模不要传此字段。" }, imageAssetId: text,
    multiViewImageAssetIds: { type: "object", additionalProperties: false, required: ["front"], properties: Object.fromEntries(
      ["front", "left", "right", "back", "top", "bottom", "leftFront", "rightFront"].map((view) => [view, text])) },
    textureImageAssetId: text, ...selection, parameters,
    outputFormats: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["glb", "obj", "fbx", "stl", "usdz", "3mf"] } }
  }), (value, context, stepId) => {
    const job = services.modelGenerations.submit(context.context.projectId, value, { source: "agent",
      conversationId: context.context.conversationId, agentRunId: context.runId, agentStepId: stepId, requestMessageId: context.context.requestMessageId });
    return { kind: "job", jobId: job.id };
  }, (value, context) => {
    const input = value as Record<string, unknown>;
    const mode = input.inputMode ?? (input.multiViewImageAssetIds ? "multiview" : input.imageAssetId ? "image" : "text");
    if ((mode === "image" && !input.imageAssetId) || (mode === "text" && !input.prompt) || (mode === "multiview" && !input.multiViewImageAssetIds)) throw new Error("缺少建模输入。");
    const selected = resolveSelection(input, context, "model");
    validateSelection(selected.providerProfileId, selected.providerModelId, "model", repositories);
    const profile = repositories.providers.requireProfile(selected.providerProfileId);
    const model = repositories.providers.requireModel(selected.providerModelId);
    const normalized = { ...input };
    if (mode !== "text") delete normalized.prompt;
    const parameters = { ...defaultModelParameters(profile.adapterType, model.remoteModelId), ...(input.parameters as Record<string, unknown> ?? {}) };
    if (input.textureImageAssetId) { parameters.textureGuideMode = "image"; delete parameters.texturePrompt; }
    return { ...normalized, inputMode: mode, ...selected, outputFormats: input.outputFormats ?? ["glb"], parameters };
  });
  return catalog;
}

function resolveSelection(input: Record<string, unknown>, context: RunContext, kind: "image" | "model") {
  if (Boolean(input.providerProfileId) !== Boolean(input.providerModelId)) throw new Error("供应商与模型必须一起选择。");
  const providerProfileId = String(input.providerProfileId ?? (kind === "image" ? context.defaults.imageProfile : context.defaults.modelProfile) ?? "");
  const providerModelId = String(input.providerModelId ?? (kind === "image" ? context.defaults.imageModel : context.defaults.modelModel) ?? "");
  if (!providerProfileId || !providerModelId) throw new Error(`尚未设置 ${kind} 默认模型。请先选择模型。`);
  return { providerProfileId, providerModelId };
}
function validateSelection(profileId: string, modelId: string, kind: string, repositories: RuntimeRepositories): void {
  const model = repositories.providers.requireModel(modelId);
  const profile = repositories.providers.requireProfile(profileId);
  if (!profile.enabled || !model.enabled || model.providerProfileId !== profileId || profile.serviceType !== kind || model.serviceType !== kind) throw new Error("选定模型不可用。");
}
