import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  ConversationSnapshot,
  JobSnapshot,
  MessageSnapshot,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import { useEffect, useRef } from "react";
import { AgentPanel } from "../components/AgentPanel.js";
import { AssetRail } from "../components/AssetRail.js";
import { Composer } from "../components/Composer.js";
import { ConversationBar } from "../components/ConversationBar.js";
import { GenerationBoard } from "../components/GenerationBoard.js";
import { Icon } from "../components/Icon.js";
import { ProviderModelSelects } from "../features/providers/ProviderModelSelects.js";

interface GenerationWorkspaceProps {
  optimizeImagePrompt: boolean;
  onOptimizeImagePromptChange: (value: boolean) => void;
  imageModelId: string;
  imageProviders: Array<{ id: string; name: string }>;
  imageModels: Array<{ id: string; providerId: string; name: string }>;
  onImageModelChange: (modelId: string) => void;
  conversations: ConversationSnapshot[];
  conversationId: string;
  conversationBusy: boolean;
  activeJobCount: number;
  onCreateConversation: () => void;
  onCreateTask: () => void;
  onOpenTasks: () => void;
  onConversationSelect: (conversationId: string) => void;
  onConversationRename: (
    conversationId: string,
    title: string
  ) => Promise<void>;
  onConversationDelete: (conversationId: string) => Promise<void>;
  assetRailCollapsed: boolean;
  assets: AssetSnapshot[];
  generationModelByAssetId: Map<string, string>;
  assetsById: Map<string, AssetSnapshot>;
  attachments: AssetSnapshot[];
  attachmentOrder: Map<string, number>;
  jobs: JobSnapshot[];
  contentUrl: (assetId: string) => string;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (asset: AssetSnapshot) => void;
  onToggleGeneratedAttachment: (assetId: string) => Promise<void>;
  onToggleAssetRail: () => void;
  onPreview: (assetId: string, fallbackName?: string) => void;
  onUploadClick: () => void;
  onRetryJob: (jobId: string) => Promise<void>;
  onDismissJob: (jobId: string) => Promise<void>;
  onEditJob: (job: JobSnapshot) => void;
  agentPanelWidth: number;
  onAgentPanelResize: (
    event: React.PointerEvent<HTMLDivElement>
  ) => void;
  messages: MessageSnapshot[];
  runs: AgentRunSnapshot[];
  stepsByRun: Map<string, AgentStepSnapshot[]>;
  assistantName: string;
  onSubmitAgentInput: (
    runId: string,
    text: string,
    choiceId?: string
  ) => Promise<void>;
  onCancelAgent: (runId: string) => Promise<void>;
  agentReady: boolean;
  onOpenSettings: () => void;
  prompt: string;
  promptTemplates: PromptTemplateSnapshot[];
  submitting: boolean;
  onPromptChange: (value: string) => void;
  onInsertPrompt: (value: string) => void;
  onRemoveAttachment: (index: number) => void;
  onReorderAttachment: (from: number, to: number) => void;
  onUpload: (files: File[]) => Promise<void>;
  onSubmit: () => Promise<void>;
  onError: (error: unknown) => void;
}

export function GenerationWorkspace(props: GenerationWorkspaceProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const lastJobIdRef = useRef<string | null>(null);
  const lastJobId = props.jobs.at(-1)?.id ?? null;

  useEffect(() => {
    if (!lastJobId) {
      lastJobIdRef.current = null;
      return;
    }
    if (lastJobId === lastJobIdRef.current) return;
    const behavior = lastJobIdRef.current ? "smooth" : "auto";
    lastJobIdRef.current = lastJobId;
    const frame = requestAnimationFrame(() => {
      boardRef.current?.scrollTo({
        top: boardRef.current.scrollHeight,
        behavior
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [lastJobId]);

  return (
    <section className="generation-page unified-workspace mode-agent">
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-primary">
          <button
            type="button"
            className="button button-secondary"
            onClick={props.onCreateConversation}
          >
            <Icon name="plus" size={16} />新建对话
          </button>
          <span>当前对话工作区</span>
        </div>
        <div className="workspace-toolbar-actions">
          <label
            className="agent-prompt-mode"
            title="仅影响 Agent 自动创建的生图任务"
          >
            <span>Agent 优化提示词</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={props.optimizeImagePrompt}
                onChange={(event) =>
                  props.onOptimizeImagePromptChange(event.target.checked)}
              />
              <span />
            </span>
          </label>
          <ProviderModelSelects
            className="workspace-provider-model-picker"
            providers={props.imageProviders}
            models={props.imageModels}
            modelId={props.imageModelId}
            providerLabel="图片供应商"
            modelLabel="图片模型"
            onModelChange={props.onImageModelChange}
          />
        </div>
      </div>

      <ConversationBar
        conversations={props.conversations}
        currentId={props.conversationId}
        busy={props.conversationBusy}
        onCreateTask={props.onCreateTask}
        onOpenTasks={props.onOpenTasks}
        activeJobCount={props.activeJobCount}
        onSelect={props.onConversationSelect}
        onRename={props.onConversationRename}
        onDelete={props.onConversationDelete}
      />

      <div
        className={`workspace-layout${
          props.assetRailCollapsed ? " asset-rail-is-collapsed" : ""
        }`}
      >
        <AssetRail
          assets={props.assets}
          generationModelByAssetId={props.generationModelByAssetId}
          attachmentOrder={props.attachmentOrder}
          collapsed={props.assetRailCollapsed}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={props.onToggleAttachment}
          onToggleCollapsed={props.onToggleAssetRail}
          onPreview={(asset) => props.onPreview(asset.id, asset.name)}
          onUploadClick={props.onUploadClick}
        />
        <div className="board-column" ref={boardRef}>
          <GenerationBoard
            jobs={props.jobs}
            assetsById={props.assetsById}
            attachmentOrder={props.attachmentOrder}
            contentUrl={props.contentUrl}
            thumbnailUrl={props.thumbnailUrl}
            onToggleAttachment={async (assetId) => {
              try {
                await props.onToggleGeneratedAttachment(assetId);
              } catch (error) {
                props.onError(error);
              }
            }}
            onPreview={props.onPreview}
            onRetry={props.onRetryJob}
            onDismiss={props.onDismissJob}
            onEdit={props.onEditJob}
          />
        </div>
        <div
          className="agent-side"
          style={{ width: props.agentPanelWidth }}
        >
          <div
            className="panel-splitter"
            role="separator"
            aria-label="调整 Agent 面板宽度"
            onPointerDown={props.onAgentPanelResize}
          />
          <AgentPanel
            messages={props.messages}
            runs={props.runs}
            stepsByRun={props.stepsByRun}
            assistantName={props.assistantName}
            assetsById={props.assetsById}
            thumbnailUrl={props.thumbnailUrl}
            onPreview={props.onPreview}
            onSubmitInput={props.onSubmitAgentInput}
            onCancel={props.onCancelAgent}
          />
        </div>
      </div>

      <div className="composer-wrap">
        {!props.agentReady && (
          <button
            type="button"
            className="agent-setup-notice"
            onClick={props.onOpenSettings}
          >
            尚未配置默认 LLM，点击前往 LLM 设置
          </button>
        )}
        <Composer
          attachments={props.attachments}
          prompt={props.prompt}
          promptTemplates={props.promptTemplates}
          busy={props.submitting}
          thumbnailUrl={props.thumbnailUrl}
          onPromptChange={props.onPromptChange}
          onInsertPrompt={props.onInsertPrompt}
          onRemove={props.onRemoveAttachment}
          onReorder={props.onReorderAttachment}
          onPreview={(asset) => props.onPreview(asset.id, asset.name)}
          onUpload={props.onUpload}
          onSubmit={props.onSubmit}
        />
      </div>
    </section>
  );
}
