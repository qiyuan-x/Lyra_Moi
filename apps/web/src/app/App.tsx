import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
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
import { CommunityPage } from "../components/CommunityPage.js";
import { Icon } from "../components/Icon.js";
import { ModelingPage } from "../components/ModelingPage.js";
import { ProjectManagerDialog } from "../components/ProjectManagerDialog.js";
import {
  findEnabledModel,
  isDefaultServiceReady,
  listEnabledModels,
  providerModelDisplayName,
  providerSnapshotLabel
} from "../features/providers/catalog-selectors.js";
import { PromptLibraryPage } from "../components/PromptLibraryPage.js";
import { SettingsPage } from "../components/SettingsPage.js";
import { AppSidebar } from "./AppSidebar.js";
import { AppTopbar } from "./AppTopbar.js";
import { ConversationWorkspace } from "./ConversationWorkspace.js";
import { ImageGenerationPage } from "./ImageGenerationPage.js";
import type { Page } from "./app-navigation.js";
import { useAgentActions } from "./useAgentActions.js";
import { useWorkspaceRefresh } from "./useWorkspaceRefresh.js";
import {
  addUniqueAsset,
  appendUniqueAssets,
  toggleSelectedAsset,
  useAssetWorkspace
} from "./useAssetWorkspace.js";
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
const PoseStudioPage = lazy(async () => {
  const module = await import("../features/pose-studio/PoseStudioPage.js");
  return { default: module.PoseStudioPage };
});

export function App() {
  const [page, setPage] = useState<Page>("generation");
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(readAppearanceMode);
  const [communityUrl, setCommunityUrl] = useState("");
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [projectId, setProjectId] = useState("");
  const [catalog, setCatalog] = useState<ProviderCatalog>({ profiles: [], models: [], defaults: { llm: null, image: null, model: null } });
  const [assets, setAssets] = useState<AssetSnapshot[]>([]);
  const [modelAssets, setModelAssets] = useState<AssetSnapshot[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplateSnapshot[]>([]);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationDraftActive, setConversationDraftActive] = useState(false);
  const [messages, setMessages] = useState<MessageSnapshot[]>([]);
  const [runs, setRuns] = useState<AgentRunSnapshot[]>([]);
  const [stepsByRun, setStepsByRun] = useState<Map<string, AgentStepSnapshot[]>>(new Map());
  const [manualAttachments, setManualAttachments] = useState<AssetSnapshot[]>([]);
  const [requestedModelAssetId, setRequestedModelAssetId] = useState("");
  const [modelId, setModelId] = useState(
    () => localStorage.getItem("lyra.selectedImageModelId") ?? ""
  );
  const [modelProviderModelId, setModelProviderModelId] = useState(
    () => localStorage.getItem("lyra.selectedModelModelId") ?? ""
  );
  const [initializing, setInitializing] = useState(true);
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [projectManagerMode, setProjectManagerMode] =
    useState<"manage" | "create" | null>(null);
  const [assetRailCollapsed, setAssetRailCollapsed] = useState(() => localStorage.getItem("lyra.assetRailCollapsed") === "true");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("lyra.mainSidebarCollapsed") === "true"
  );
  const [agentPanelWidth, setAgentPanelWidth] = useState(400);
  const [preview, setPreview] = useState<{ assetId: string; name: string } | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const previewDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearanceMode(appearanceMode);
    apply();
    if (appearanceMode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearanceMode]);

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
  const conversationJobs = useMemo(() => {
    const scopedJobs = jobs.filter(
      (job) => job.conversationId === conversationId
    );
    return [...scopedJobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [conversationId, jobs]);
  const manualImageJobs = useMemo(
    () => jobs
      .filter((job) => job.kind === "image.generate" && job.source === "manual")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [jobs]
  );
  const manualAttachmentOrder = useMemo(
    () => new Map(manualAttachments.map((asset, index) => [asset.id, index + 1])),
    [manualAttachments]
  );
  const selectedImageModel = findEnabledModel(catalog, "image", modelId);
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
  const selectedModelModel = findEnabledModel(
    catalog,
    "model",
    modelProviderModelId
  );
  const enabledModelProviders = useMemo(
    () => catalog.profiles.filter((profile) =>
      profile.serviceType === "model" &&
      profile.enabled &&
      enabledModelModels.some(
        (model) => model.providerProfileId === profile.id
      )
    ),
    [catalog.profiles, enabledModelModels]
  );
  const modelProviderOptions = useMemo(
    () => enabledModelProviders.map((profile) => ({
      id: profile.id,
      name: profile.name
    })),
    [enabledModelProviders]
  );
  const modelModelOptions = useMemo(
    () => enabledModelModels.map((model) => ({
      id: model.id,
      providerId: model.providerProfileId,
      name: providerModelDisplayName(model)
    })),
    [enabledModelModels]
  );
  const defaultLlmModel = catalog.models.find(
    (model) => model.id === catalog.defaults.llm
  );
  const agentReady = isDefaultServiceReady(catalog, "llm");

  const pushNotice = useCallback((_type: string, _text: string) => undefined, []);
  const reportError = useCallback((_error: unknown) => undefined, []);

  const workspaceRefreshOptions = useMemo(() => ({
    api,
    projectId,
    conversationId,
    conversationDraftActive,
    setAssets,
    setModelAssets,
    setJobs,
    setConversations,
    setConversationId,
    setMessages,
    setRuns,
    setStepsByRun,
    reportError
  }), [conversationDraftActive, conversationId, projectId, reportError]);
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
    uploadAssets,
    upload,
    updateAsset,
    deleteAsset,
    deleteAssets
  } = useAssetWorkspace({
    api,
    projectId,
    assets,
    setAssets,
    setModelAssets,
    onNotice: (text) => pushNotice("success", text),
    onError: reportError
  });

  async function deleteModelAssets(assetIds: string[]) {
    await deleteAssets(assetIds);
    pushNotice("success", "模型已删除");
  }
  const {
    prompt,
    setPrompt,
    insertPromptText,
    clearPrompt,
    createPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
    setPromptPreview,
    deletePromptPreview
  } = usePromptWorkspace({
    api,
    setPrompts,
    onError: reportError
  });
  const {
    projectBusy,
    createProject,
    updateProject,
    deleteProject
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
    dismissJob
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
    startNewConversation,
    renameConversation,
    deleteConversation
  } = useConversationWorkspace({
    api,
    projectId,
    conversationId,
    setConversations,
    setConversationId,
    setConversationDraftActive,
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
    selectedImageModel,
    selectedModelModel,
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

  const selectConversation = useCallback((nextConversationId: string) => {
    setConversationDraftActive(false);
    setConversationId(nextConversationId);
  }, []);

  useEffect(() => {
    setConversationDraftActive(false);
  }, [projectId]);
  const {
    editingImageJob,
    setEditingImageJob,
    imageSubmitting,
    modelSubmitting,
    submitConfiguredTask,
    submitModelGeneration
  } = useGenerationActions({
    api,
    catalog,
    projectId,
    selectedImageModel,
    setAttachments: setManualAttachments,
    refreshProject,
    onNotice: (text) => pushNotice("success", text),
    onError: reportError
  });

  const initializeApplication = useCallback(async () => {
    try {
      const [nextProjects, nextCatalog, nextPrompts, community] = await Promise.all([
        api.listProjects(),
        api.listProviders(),
        api.listPrompts(),
        api.getCommunitySettings()
      ]);
      setProjects(nextProjects);
      setCatalog(nextCatalog);
      setPrompts(nextPrompts);
      setCommunityUrl(community.settings.url);
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
    setEditingImageJob(null);
    setPreview(null);
    setModelAssets([]);
    setManualAttachments([]);
    setRequestedModelAssetId("");
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
    if (modelId) localStorage.setItem("lyra.selectedImageModelId", modelId);
  }, [modelId]);

  useEffect(() => {
    if (modelProviderModelId) {
      localStorage.setItem("lyra.selectedModelModelId", modelProviderModelId);
    }
  }, [modelProviderModelId]);

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const preventBackgroundScroll = (event: WheelEvent) => event.preventDefault();
    window.addEventListener("wheel", preventBackgroundScroll, {
      capture: true,
      passive: false
    });
    return () => window.removeEventListener("wheel", preventBackgroundScroll, true);
  }, [preview]);

  useEffect(() => {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
    setPreviewDragging(false);
    previewDragRef.current = null;
  }, [preview?.assetId]);

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

  function toggleManualAttachment(asset: AssetSnapshot) {
    setManualAttachments((current) => toggleSelectedAsset(current, asset));
  }

  async function toggleManualGeneratedAttachment(assetId: string) {
    let asset = assetsById.get(assetId);
    if (!asset) {
      asset = await api.getAsset(assetId);
      setAssets((current) => [asset!, ...current.filter((item) => item.id !== asset!.id)]);
    }
    setManualAttachments((current) => toggleSelectedAsset(current, asset!));
  }

  async function uploadManualImages(files: File[]) {
    const uploaded = await uploadAssets(files);
    setManualAttachments((current) => appendUniqueAssets(current, uploaded));
  }

  function editManualImageJob(job: JobSnapshot) {
    setEditingImageJob(job);
    setManualAttachments(
      job.inputs.flatMap((input) => {
        const asset = assetsById.get(input.assetId);
        return asset ? [asset] : [];
      })
    );
    setPage("generation");
  }

  function openPreview(assetId: string, fallbackName = "图片预览") {
    setPreview({ assetId, name: assetsById.get(assetId)?.name ?? fallbackName });
  }

  function zoomPreview(delta: number) {
    const next = Math.min(4, Math.max(0.5, Math.round((previewZoom + delta) * 100) / 100));
    setPreviewZoom(next);
    if (next <= 1) setPreviewOffset({ x: 0, y: 0 });
  }

  function resetPreviewView() {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
  }

  function handlePreviewWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    zoomPreview(event.deltaY < 0 ? 0.15 : -0.15);
  }

  function handlePreviewPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewZoom <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: previewOffset.x,
      offsetY: previewOffset.y
    };
    setPreviewDragging(true);
  }

  function handlePreviewPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreviewOffset({
      x: drag.offsetX + event.clientX - drag.startX,
      y: drag.offsetY + event.clientY - drag.startY
    });
  }

  function stopPreviewDragging(event?: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewDragRef.current;
    if (event && drag?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    previewDragRef.current = null;
    setPreviewDragging(false);
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
        api={api}
        page={page}
        collapsed={sidebarCollapsed}
        conversations={conversations}
        conversationId={conversationId}
        conversationDraftActive={conversationDraftActive}
        conversationBusy={conversationBusy}
        onPageChange={(nextPage) => {
          if (nextPage === "model") setRequestedModelAssetId("");
          setPage(nextPage);
        }}
        onToggleCollapsed={toggleSidebar}
        onCreateConversation={() => {
          clearComposer();
          startNewConversation();
        }}
        onConversationSelect={selectConversation}
        onConversationRename={renameConversation}
        onConversationDelete={deleteConversation}
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
        ) : page === "community" ? (
          <CommunityPage
            url={communityUrl}
            onOpenSettings={() => setPage("settings")}
          />
        ) : page === "generation" ? (
          <ImageGenerationPage
            key={projectId}
            projectId={projectId}
            imageModelId={modelId}
            imageProviders={imageProviderOptions}
            imageModels={imageModelOptions}
            onImageModelChange={setModelId}
            editingJob={editingImageJob}
            promptTemplates={prompts}
            submitting={imageSubmitting}
            attachments={manualAttachments}
            onAttachmentsChange={setManualAttachments}
            onCancelEdit={() => setEditingImageJob(null)}
            onSubmit={submitConfiguredTask}
            onUpload={uploadManualImages}
            onUploadClick={() => uploadInputRef.current?.click()}
            assetRailCollapsed={assetRailCollapsed}
            assets={assets}
            generationModelByAssetId={generationModelByAssetId}
            assetsById={assetsById}
            attachmentOrder={manualAttachmentOrder}
            jobs={manualImageJobs}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            onToggleAttachment={toggleManualAttachment}
            onToggleGeneratedAttachment={toggleManualGeneratedAttachment}
            onToggleAssetRail={toggleAssetRail}
            onPreview={openPreview}
            onRetryJob={retryJob}
            onDismissJob={dismissJob}
            onEditJob={editManualImageJob}
            onError={reportError}
          />
        ) : page === "conversation" ? (
          <ConversationWorkspace
            key={projectId}
            imageModelId={modelId}
            imageProviders={imageProviderOptions}
            imageModels={imageModelOptions}
            onImageModelChange={setModelId}
            conversations={conversations}
            conversationId={conversationId}
            conversationBusy={conversationBusy}
            onCreateConversation={() => {
              clearComposer();
              startNewConversation();
            }}
            onConversationSelect={selectConversation}
            onConversationRename={renameConversation}
            onConversationDelete={deleteConversation}
            modelModelId={modelProviderModelId}
            modelProviders={modelProviderOptions}
            modelModels={modelModelOptions}
            onModelModelChange={setModelProviderModelId}
            assets={assets}
            modelAssets={modelAssets}
            assetsById={assetsById}
            attachments={attachments}
            attachmentOrder={attachmentOrder}
            jobs={conversationJobs}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            onToggleAttachment={toggleAttachment}
            onToggleGeneratedAttachment={toggleGeneratedAttachment}
            onPreview={openPreview}
            onUploadClick={() => uploadInputRef.current?.click()}
            onRetryJob={retryJob}
            onDismissJob={dismissJob}
            onEditJob={editManualImageJob}
            onViewModel={(assetId) => {
              setRequestedModelAssetId(assetId);
              setPage("model");
            }}
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
            modelAssets={modelAssets}
            jobs={jobs}
            generationModelByAssetId={generationModelByAssetId}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            onAttach={(asset) => {
              setManualAttachments((current) => addUniqueAsset(current, asset));
              setPage("generation");
            }}
            onPreview={(asset) => openPreview(asset.id, asset.name)}
            onViewModel={(assetId) => {
              setRequestedModelAssetId(assetId);
              setPage("model");
            }}
            onUpload={() => uploadInputRef.current?.click()}
            onUploadFiles={uploadAssets}
            onUpdate={updateAsset}
            onDelete={deleteAsset}
            onDeleteModel={deleteModelAssets}
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
            initialModelAssetId={requestedModelAssetId}
            defaultModelId={modelProviderModelId}
            busy={modelSubmitting}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            onUpload={uploadAssets}
            onDefaultModelChange={setModelProviderModelId}
            onGenerate={submitModelGeneration}
            onCancel={cancelJob}
            onRetry={retryJob}
            onDismiss={dismissJob}
            onDeleteModel={deleteModelAssets}
            onOpenSettings={() => setPage("settings")}
          />
        ) : page === "pose" ? (
          <Suspense fallback={<div className="boot-state"><span className="spinner" />正在加载动作编辑器</div>}>
            <PoseStudioPage
              key={projectId}
              projectId={projectId}
              api={api}
              onSaveScreenshot={async (file) => {
                await uploadAssets([file]);
                pushNotice("success", "动作截图已保存到当前项目素材库");
              }}
            />
          </Suspense>
        ) : page === "prompts" ? (
          <PromptLibraryPage
            prompts={prompts}
            generatedImages={assets.filter((asset) =>
              asset.kind === "image" && asset.source === "generated")}
            thumbnailUrl={(assetId) => api.assetThumbnailUrl(assetId)}
            contentUrl={(assetId) => api.assetContentUrl(assetId)}
            previewUrl={(promptId) => api.promptPreviewUrl(promptId)}
            onCreate={createPromptTemplate}
            onUpdate={updatePromptTemplate}
            onDelete={deletePromptTemplate}
            onSetPreview={setPromptPreview}
            onDeletePreview={deletePromptPreview}
          />
        ) : page === "settings" ? (
          <SettingsPage
            api={api}
            catalog={catalog}
            appearanceMode={appearanceMode}
            onChanged={setCatalog}
            onError={reportError}
            onCommunityChanged={setCommunityUrl}
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
          if (event.target.files) {
            const files = Array.from(event.target.files);
            if (page === "generation") {
              void uploadManualImages(files);
            } else if (page === "conversation") {
              void upload(files);
            } else {
              void uploadAssets(files).catch(() => undefined);
            }
          }
          event.target.value = "";
        }}
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
          onDelete={deleteProject}
        />
      )}

      {preview && (
        <div className="modal-backdrop" onMouseDown={() => setPreview(null)}>
          <div className="image-modal" role="dialog" aria-modal="true" aria-label={preview.name} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>{preview.name}</strong>
              <div className="image-modal-actions">
                <button type="button" className="icon-button" aria-label="缩小图片" onClick={() => zoomPreview(-0.25)} disabled={previewZoom <= 0.5}><Icon name="minus" size={17} /></button>
                <button type="button" className="icon-button" aria-label="复位图片视图" onClick={resetPreviewView} disabled={previewZoom === 1 && previewOffset.x === 0 && previewOffset.y === 0}><Icon name="retry" size={17} /></button>
                <button type="button" className="icon-button" aria-label="放大图片" onClick={() => zoomPreview(0.25)} disabled={previewZoom >= 4}><Icon name="plus" size={17} /></button>
                <button type="button" className="icon-button" aria-label="关闭图片预览" onClick={() => setPreview(null)}><Icon name="close" size={19} /></button>
              </div>
            </header>
            <div
              className={`image-modal-viewport${previewZoom > 1 ? " zoomable" : ""}${previewDragging ? " is-dragging" : ""}`}
              onWheel={handlePreviewWheel}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={stopPreviewDragging}
              onPointerCancel={stopPreviewDragging}
            >
              <img
                src={api.assetContentUrl(preview.assetId)}
                alt={preview.name}
                draggable={false}
                style={{ transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0) scale(${previewZoom})` }}
              />
            </div>
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
              <button
                type="button"
                className="button button-primary"
                onClick={() => void (
                  page === "generation"
                    ? toggleManualGeneratedAttachment(preview.assetId)
                    : attachGenerated(preview.assetId)
                ).then(() => setPreview(null)).catch(reportError)}
              >
                {page === "generation" ? "用于图片生成" : "引用到对话"}
              </button>
            </footer>
          </div>
        </div>
      )}

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

