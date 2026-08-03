import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  ConversationSnapshot,
  JobSnapshot,
  MessageSnapshot,
  ProjectSnapshot,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import { AssetLibraryPage } from "../components/AssetLibraryPage.js";
import { Icon } from "../components/Icon.js";
import { NoticeCenter, type NoticeItem, type NoticeType } from "../components/NoticeCenter.js";
import { ModelingPage } from "../components/ModelingPage.js";
import { ProjectManagerDialog } from "../components/ProjectManagerDialog.js";
import {
  isDefaultServiceReady,
  listEnabledModels,
  providerModelDisplayName,
  providerSnapshotLabel
} from "../features/providers/catalog-selectors.js";
import { PromptLibraryPage } from "../components/PromptLibraryPage.js";
import { SettingsPage } from "../components/SettingsPage.js";
import { TaskDrawer } from "../components/TaskDrawer.js";
import { TaskEditor } from "../components/TaskEditor.js";
import { AppSidebar } from "./AppSidebar.js";
import { AppTopbar } from "./AppTopbar.js";
import { GenerationWorkspace } from "./GenerationWorkspace.js";
import type { Page } from "./app-navigation.js";
import { useAgentActions } from "./useAgentActions.js";
import { useWorkspaceRefresh } from "./useWorkspaceRefresh.js";
import { useAssetWorkspace } from "./useAssetWorkspace.js";
import { useConversationWorkspace } from "./useConversationWorkspace.js";
import { useGenerationActions } from "./useGenerationActions.js";
import { useJobActions } from "./useJobActions.js";
import { useProjectActions } from "./useProjectActions.js";
import { usePromptWorkspace } from "./usePromptWorkspace.js";
import {
  ApiClient,
  ApiClientError,
  getAccessToken,
  setAccessToken,
  type ProviderCatalog,
  toOrderedAttachments
} from "../lib/api-client.js";
import {
  applyAppearanceMode,
  readAppearanceMode,
  saveAppearanceMode,
  type AppearanceMode
} from "../lib/appearance.js";

const api = new ApiClient();

export function App() {
  const [page, setPage] = useState<Page>("generation");
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(readAppearanceMode);
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [projectId, setProjectId] = useState("");
  const [catalog, setCatalog] = useState<ProviderCatalog>({ profiles: [], models: [], defaults: { llm: null, image: null, model: null } });
  const [assets, setAssets] = useState<AssetSnapshot[]>([]);
  const [modelAssets, setModelAssets] = useState<AssetSnapshot[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplateSnapshot[]>([]);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<MessageSnapshot[]>([]);
  const [runs, setRuns] = useState<AgentRunSnapshot[]>([]);
  const [stepsByRun, setStepsByRun] = useState<Map<string, AgentStepSnapshot[]>>(new Map());
  const [modelId, setModelId] = useState("");
  const [modelProviderModelId, setModelProviderModelId] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [projectManagerMode, setProjectManagerMode] =
    useState<"manage" | "create" | null>(null);
  const [assetRailCollapsed, setAssetRailCollapsed] = useState(() => localStorage.getItem("lyra.assetRailCollapsed") === "true");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("lyra.mainSidebarCollapsed") === "true"
  );
  const [optimizeImagePrompt, setOptimizeImagePrompt] = useState(
    () => localStorage.getItem("lyra.agentOptimizeImagePrompt") !== "false"
  );
  const [agentPanelWidth, setAgentPanelWidth] = useState(400);
  const [preview, setPreview] = useState<{ assetId: string; name: string } | null>(null);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const noticeIdRef = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearanceMode(appearanceMode);
    apply();
    if (appearanceMode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearanceMode]);

  const sortedJobs = useMemo(
    () => [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [jobs]
  );
  const generationJobByAssetId = useMemo(() => {
    const result = new Map<string, JobSnapshot>();
    for (const job of jobs) {
      for (const output of job.outputs) result.set(output.assetId, job);
    }
    return result;
  }, [jobs]);
  const generationModelByAssetId = useMemo(() => {
    const result = new Map<string, string>();
    for (const [assetId, job] of generationJobByAssetId) {
      result.set(
        assetId,
        providerSnapshotLabel(job.providerName, job.remoteModelId)
      );
    }
    return result;
  }, [generationJobByAssetId]);
  const previewGenerationJob = preview
    ? generationJobByAssetId.get(preview.assetId)
    : undefined;
  const workspaceJobs = useMemo(() => {
    const scopedJobs = jobs.filter((job) => job.conversationId === conversationId);
    return [...scopedJobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [conversationId, jobs]);
  const activeJobCount = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const selectedImageModel = catalog.models.find((model) => model.id === modelId);
  const enabledImageModels = useMemo(
    () => listEnabledModels(catalog, "image"),
    [catalog]
  );
  const enabledImageProviders = useMemo(
    () => catalog.profiles.filter((profile) =>
      profile.serviceType === "image" &&
      profile.enabled &&
      enabledImageModels.some(
        (model) => model.providerProfileId === profile.id
      )
    ),
    [catalog.profiles, enabledImageModels]
  );
  const imageProviderOptions = useMemo(
    () => enabledImageProviders.map((profile) => ({
      id: profile.id,
      name: profile.name
    })),
    [enabledImageProviders]
  );
  const imageModelOptions = useMemo(
    () => enabledImageModels.map((model) => ({
      id: model.id,
      providerId: model.providerProfileId,
      name: providerModelDisplayName(model)
    })),
    [enabledImageModels]
  );
  const enabledModelModels = useMemo(
    () => listEnabledModels(catalog, "model"),
    [catalog]
  );
  const defaultLlmModel = catalog.models.find(
    (model) => model.id === catalog.defaults.llm
  );
  const agentReady = isDefaultServiceReady(catalog, "llm");

  const pushNotice = useCallback((type: NoticeType, text: string) => {
    const item: NoticeItem = { id: ++noticeIdRef.current, type, text };
    setNotices((current) => [
      ...current.filter((notice) => notice.type !== type || notice.text !== text),
      item
    ].slice(-3));
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const reportError = useCallback((error: unknown) => {
    pushNotice("error", error instanceof Error ? error.message : "操作失败，请重试。");
  }, [pushNotice]);

  const workspaceRefreshOptions = useMemo(() => ({
    api,
    projectId,
    conversationId,
    setAssets,
    setModelAssets,
    setJobs,
    setConversations,
    setConversationId,
    setMessages,
    setRuns,
    setStepsByRun,
    reportError
  }), [conversationId, projectId, reportError]);
  const { refreshProject, refreshConversation } = useWorkspaceRefresh(workspaceRefreshOptions);
  const {
    attachments,
    setAttachments,
    assetsById,
    attachmentOrder,
    addAttachment,
    toggleAttachment,
    attachGenerated,
    toggleGeneratedAttachment,
    upload,
    updateAsset,
    deleteAsset
  } = useAssetWorkspace({
    api,
    projectId,
    assets,
    setAssets,
    onNotice: (text) => pushNotice("success", text),
    onError: reportError
  });
  const {
    prompt,
    setPrompt,
    insertPromptText,
    clearPrompt,
    createPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate
  } = usePromptWorkspace({
    api,
    setPrompts,
    onError: reportError
  });
  const {
    projectBusy,
    createProject,
    updateProject,
    archiveProject
  } = useProjectActions({
    api,
    projects,
    projectId,
    setProjects,
    setProjectId,
    closeManager: () => setProjectManagerMode(null),
    onNotice: (text) => pushNotice("success", text),
    onError: reportError
  });
  const {
    cancelJob,
    retryJob,
    dismissJob,
    clearFailedJobs
  } = useJobActions({
    api,
    projectId,
    selectedImageModel,
    setJobs,
    refreshProject,
    onError: reportError
  });
  const {
    conversationBusy,
    ensureCurrentConversation,
    createNewConversation,
    renameConversation,
    deleteConversation
  } = useConversationWorkspace({
    api,
    projectId,
    conversationId,
    setConversations,
    setConversationId,
    setMessages,
    setRuns,
    setStepsByRun,
    refreshProject,
    onError: reportError
  });
  const {
    submitting,
    submitAgent,
    submitAgentInput,
    cancelAgent
  } = useAgentActions({
    api,
    projectId,
    conversationId,
    prompt,
    attachments,
    optimizeImagePrompt,
    selectedImageModel,
    agentReady,
    ensureCurrentConversation,
    clearComposer,
    setAttachments,
    refreshProject,
    refreshConversation,
    onMissingLlm: () => {
      pushNotice(
        "error",
        "请先在 LLM 设置中添加并选择一个默认模型。"
      );
      setPage("settings");
    },
    onError: reportError
  });
  const {
    taskEditor,
    setTaskEditor,
    taskEditorBusy,
    modelSubmitting,
    openNewTask,
    submitConfiguredTask,
    submitModelGeneration
  } = useGenerationActions({
    api,
    catalog,
    projectId,
    selectedImageModel,
    ensureCurrentConversation,
    setAttachments,
    refreshProject,
    onNotice: (text) => pushNotice("success", text),
    onError: reportError
  });

  const initializeApplication = useCallback(async () => {
    try {
      const [nextProjects, nextCatalog, nextPrompts] = await Promise.all([
        api.listProjects(),
        api.listProviders(),
        api.listPrompts()
      ]);
      setProjects(nextProjects);
      setCatalog(nextCatalog);
      setPrompts(nextPrompts);
      setProjectId(nextProjects[0]?.id ?? "");
      setAccessRequired(false);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setAccessRequired(true);
        setAccessError(getAccessToken() ? "访问令牌无效，请重新输入。" : "");
      } else {
        reportError(error);
      }
    } finally {
      setInitializing(false);
    }
  }, [reportError]);

  useEffect(() => {
    void initializeApplication();
  }, [initializeApplication]);

  useEffect(() => {
    if (!projectId) return;
    setTaskEditor(null);
    setPreview(null);
    setModelAssets([]);
    void refreshProject(projectId).catch(reportError);
  }, [projectId, refreshProject, reportError]);

  useEffect(() => {
    void refreshConversation(conversationId).catch(reportError);
  }, [conversationId, refreshConversation, reportError]);

  useEffect(() => {
    setModelId((current) => {
      if (enabledImageModels.some((model) => model.id === current)) return current;
      const preferred = enabledImageModels.find((model) => model.id === catalog.defaults.image);
      return preferred?.id ?? enabledImageModels[0]?.id ?? "";
    });
  }, [catalog.defaults.image, enabledImageModels]);

  useEffect(() => {
    setModelProviderModelId((current) => {
      if (enabledModelModels.some((model) => model.id === current)) return current;
      const preferred = enabledModelModels.find((model) => model.id === catalog.defaults.model);
      return preferred?.id ?? enabledModelModels[0]?.id ?? "";
    });
  }, [catalog.defaults.model, enabledModelModels]);

  useEffect(() => {
    localStorage.setItem("lyra.agentOptimizeImagePrompt", String(optimizeImagePrompt));
  }, [optimizeImagePrompt]);

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);

  function toggleAssetRail() {
    setAssetRailCollapsed((current) => {
      const next = !current;
      localStorage.setItem("lyra.assetRailCollapsed", String(next));
      return next;
    });
  }

  function startAgentPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentPanelWidth;
    const move = (moveEvent: PointerEvent) => {
      const maximum = Math.max(288, Math.floor(window.innerWidth * .46));
      setAgentPanelWidth(Math.min(maximum, Math.max(288, startWidth + startX - moveEvent.clientX)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function clearComposer() {
    clearPrompt();
    setAttachments([]);
  }

  function openPreview(assetId: string, fallbackName = "图片预览") {
    setPreview({ assetId, name: assetsById.get(assetId)?.name ?? fallbackName });
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem("lyra.mainSidebarCollapsed", String(next));
      return next;
    });
  }

  if (initializing) {
    return <div className="boot-state"><span className="spinner" />正在连接 Lyra 服务</div>;
  }

  if (accessRequired) {
    return <AccessGate error={accessError} onSubmit={(token) => {
      setAccessToken(token);
      setAccessError("");
      setInitializing(true);
      void initializeApplication();
    }} />;
  }

  return (
    <div className="app-shell">
      <AppSidebar
        page={page}
        collapsed={sidebarCollapsed}
        onPageChange={setPage}
        onToggleCollapsed={toggleSidebar}
      />

      <main className="app-main">
        <AppTopbar
          page={page}
          projects={projects}
          projectId={projectId}
          onProjectSelect={setProjectId}
          onProjectCreate={() => setProjectManagerMode("create")}
          onProjectManage={() => setProjectManagerMode("manage")}
        />

        {projects.length === 0 ? (
          <section className="page-placeholder">
            <Icon name="settings" size={32} />
            <h1>尚未创建项目</h1>
            <p>请先通过初始化流程创建默认项目。</p>
          </section>
        ) : page === "generation" ? (
          <GenerationWorkspace
            optimizeImagePrompt={optimizeImagePrompt}
            onOptimizeImagePromptChange={setOptimizeImagePrompt}
            imageModelId={modelId}
            imageProviders={imageProviderOptions}
            imageModels={imageModelOptions}
            onImageModelChange={setModelId}
            conversations={conversations}
            conversationId={conversationId}
            conversationBusy={conversationBusy}
            activeJobCount={activeJobCount}
            onCreateConversation={() => void createNewConversation()}
            onCreateTask={() => void openNewTask()}
            onOpenTasks={() => setTaskDrawerOpen(true)}
            onConversationSelect={setConversationId}
            onConversationRename={renameConversation}
            onConversationDelete={deleteConversation}
            assetRailCollapsed={assetRailCollapsed}
            assets={assets}
            generationModelByAssetId={generationModelByAssetId}
            assetsById={assetsById}
            attachments={attachments}
            attachmentOrder={attachmentOrder}
            jobs={workspaceJobs}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            onToggleAttachment={toggleAttachment}
            onToggleGeneratedAttachment={toggleGeneratedAttachment}
            onToggleAssetRail={toggleAssetRail}
            onPreview={openPreview}
            onUploadClick={() => uploadInputRef.current?.click()}
            onRetryJob={retryJob}
            onDismissJob={dismissJob}
            onEditJob={(job) => setTaskEditor({ job })}
            agentPanelWidth={agentPanelWidth}
            onAgentPanelResize={startAgentPanelResize}
            messages={messages}
            runs={runs}
            stepsByRun={stepsByRun}
            assistantName={defaultLlmModel?.displayName || "AI"}
            onSubmitAgentInput={submitAgentInput}
            onCancelAgent={cancelAgent}
            agentReady={agentReady}
            onOpenSettings={() => setPage("settings")}
            prompt={prompt}
            promptTemplates={prompts}
            submitting={submitting}
            onPromptChange={setPrompt}
            onInsertPrompt={insertPromptText}
            onRemoveAttachment={(index) =>
              setAttachments((current) =>
                current.filter((_, itemIndex) => itemIndex !== index)
              )}
            onReorderAttachment={(from, to) =>
              setAttachments((current) => reorder(current, from, to))}
            onUpload={upload}
            onSubmit={submitAgent}
            onError={reportError}
          />
        ) : page === "assets" ? (
          <AssetLibraryPage
            assets={assets}
            generationModelByAssetId={generationModelByAssetId}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            onAttach={(asset) => { addAttachment(asset); setPage("generation"); }}
            onPreview={(asset) => openPreview(asset.id, asset.name)}
            onUpload={() => uploadInputRef.current?.click()}
            onUpdate={updateAsset}
            onDelete={deleteAsset}
          />
        ) : page === "model" ? (
          <ModelingPage
            key={projectId}
            projectId={projectId}
            images={assets}
            models={enabledModelModels}
            profiles={catalog.profiles}
            modelAssets={modelAssets}
            jobs={jobs}
            defaultModelId={modelProviderModelId}
            busy={modelSubmitting}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            onDefaultModelChange={setModelProviderModelId}
            onGenerate={submitModelGeneration}
            onCancel={cancelJob}
            onRetry={retryJob}
            onDismiss={dismissJob}
            onOpenSettings={() => setPage("settings")}
          />
        ) : page === "prompts" ? (
          <PromptLibraryPage
            prompts={prompts}
            onCreate={createPromptTemplate}
            onUpdate={updatePromptTemplate}
            onDelete={deletePromptTemplate}
          />
        ) : page === "settings" ? (
          <SettingsPage
            api={api}
            catalog={catalog}
            appearanceMode={appearanceMode}
            onChanged={setCatalog}
            onError={reportError}
            onAppearanceChange={(mode) => {
              saveAppearanceMode(mode);
              setAppearanceMode(mode);
            }}
          />
        ) : (
          <></>
        )}
      </main>

      <input
        ref={uploadInputRef}
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          if (event.target.files) void upload(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      <TaskDrawer
        open={taskDrawerOpen}
        jobs={sortedJobs}
        onClose={() => setTaskDrawerOpen(false)}
        onCancel={cancelJob}
        onRetry={retryJob}
        onDismiss={dismissJob}
        onClearFailed={clearFailedJobs}
      />

      {projectManagerMode && (
        <ProjectManagerDialog
          projects={projects}
          currentId={projectId}
          busy={projectBusy}
          initialCreating={projectManagerMode === "create"}
          onClose={() => setProjectManagerMode(null)}
          onSelect={(targetProjectId) => {
            setProjectId(targetProjectId);
            setProjectManagerMode(null);
          }}
          onCreate={createProject}
          onUpdate={updateProject}
          onArchive={archiveProject}
        />
      )}

      {taskEditor && (
        <TaskEditor
          job={taskEditor.job}
          assets={assets}
          initialAttachments={attachments}
          promptTemplates={prompts}
          providers={imageProviderOptions}
          models={imageModelOptions}
          defaultModelId={modelId}
          busy={taskEditorBusy}
          thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
          onClose={() => setTaskEditor(null)}
          onPreview={(asset) => openPreview(asset.id, asset.name)}
          onUploadClick={() => uploadInputRef.current?.click()}
          onSubmit={submitConfiguredTask}
        />
      )}

      {preview && (
        <div className="modal-backdrop" onMouseDown={() => setPreview(null)}>
          <div className="image-modal" role="dialog" aria-modal="true" aria-label={preview.name} onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>{preview.name}</strong><button type="button" className="icon-button" onClick={() => setPreview(null)}><Icon name="close" size={19} /></button></header>
            <img src={api.assetContentUrl(preview.assetId)} alt={preview.name} />
            <footer>
              {previewGenerationJob && (
                <div className="image-provenance">
                  <span>生成模型</span>
                  <strong title={generationModelByAssetId.get(preview.assetId)}>
                    {generationModelByAssetId.get(preview.assetId)}
                  </strong>
                  <small>{new Date(previewGenerationJob.createdAt).toLocaleString("zh-CN")}</small>
                </div>
              )}
              <button type="button" className="button button-primary" onClick={() => void attachGenerated(preview.assetId).then(() => setPreview(null)).catch(reportError)}>引用到输入框</button>
            </footer>
          </div>
        </div>
      )}

      <NoticeCenter items={notices} onDismiss={dismissNotice} />
    </div>
  );
}

function AccessGate(props: { error: string; onSubmit: (token: string) => void }) {
  const [token, setToken] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (token.trim()) props.onSubmit(token.trim());
  }

  return (
    <main className="access-gate">
      <form onSubmit={submit}>
        <div className="access-gate-mark">L</div>
        <h1>访问 Lyra</h1>
        <p>输入服务器管理员提供的单用户访问令牌。</p>
        {props.error && <p className="access-gate-error">{props.error}</p>}
        <label className="field">
          <span>访问令牌</span>
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoFocus autoComplete="current-password" />
        </label>
        <button type="submit" className="button button-primary" disabled={!token.trim()}>进入工作区</button>
      </form>
    </main>
  );
}

function reorder<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

