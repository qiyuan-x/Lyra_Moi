import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  ConversationSnapshot,
  JobSnapshot,
  MessageSnapshot,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import { AgentPanel } from "../components/AgentPanel.js";
import { AssetPickerDialog } from "../components/AssetPickerDialog.js";
import { Composer } from "../components/Composer.js";
import { ConversationManager } from "../components/ConversationManager.js";
import { GenerationBoard } from "../components/GenerationBoard.js";
import { Icon } from "../components/Icon.js";
import { ConversationTaskDialog } from "../features/conversations/ConversationTaskDialog.js";
import { ConversationModelSelectors } from "../features/providers/ConversationModelSelectors.js";

interface ConversationWorkspaceProps {
  imageModelId: string;
  imageProviders: Array<{ id: string; name: string }>;
  imageModels: Array<{ id: string; providerId: string; name: string }>;
  onImageModelChange: (modelId: string) => void;
  modelModelId: string;
  modelProviders: Array<{ id: string; name: string }>;
  modelModels: Array<{ id: string; providerId: string; name: string }>;
  onModelModelChange: (modelId: string) => void;
  conversations: ConversationSnapshot[];
  conversationId: string;
  conversationBusy: boolean;
  onCreateConversation: () => void;
  onConversationSelect: (conversationId: string) => void;
  onConversationRename: (conversationId: string, title: string) => Promise<void>;
  onConversationDelete: (conversationId: string) => Promise<void>;
  assets: AssetSnapshot[];
  modelAssets: AssetSnapshot[];
  assetsById: Map<string, AssetSnapshot>;
  attachments: AssetSnapshot[];
  attachmentOrder: Map<string, number>;
  jobs: JobSnapshot[];
  contentUrl: (assetId: string) => string;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (asset: AssetSnapshot) => void;
  onToggleGeneratedAttachment: (assetId: string) => Promise<void>;
  onPreview: (assetId: string, fallbackName?: string) => void;
  onUploadClick: () => void;
  onRetryJob: (jobId: string) => Promise<void>;
  onDismissJob: (jobId: string) => Promise<void>;
  onEditJob: (job: JobSnapshot) => void;
  onViewModel: (assetId: string) => void;
  agentPanelWidth: number;
  onAgentPanelResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  messages: MessageSnapshot[];
  runs: AgentRunSnapshot[];
  stepsByRun: Map<string, AgentStepSnapshot[]>;
  assistantName: string;
  onSubmitAgentInput: (runId: string, text: string, choiceId?: string) => Promise<void>;
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

export function ConversationWorkspace(props: ConversationWorkspaceProps) {
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastJobKeyRef = useRef<string | null>(null);
  const imageJobs = useMemo(
    () => props.jobs.filter((job) => job.kind === "image.generate"),
    [props.jobs]
  );
  const modelJobs = useMemo(
    () => props.jobs.filter((job) => job.kind === "model.generate"),
    [props.jobs]
  );
  const modelAssetsById = useMemo(
    () => new Map(props.modelAssets.map((asset) => [asset.id, asset])),
    [props.modelAssets]
  );
  const lastJob = imageJobs.at(-1);
  const lastJobKey = lastJob
    ? `${lastJob.id}:${lastJob.status}:${lastJob.outputs.length}`
    : null;

  useEffect(() => {
    if (!lastJobKey) {
      lastJobKeyRef.current = null;
      return;
    }
    if (lastJobKey === lastJobKeyRef.current) return;
    const behavior = lastJobKeyRef.current ? "smooth" : "auto";
    lastJobKeyRef.current = lastJobKey;
    const frame = requestAnimationFrame(() => {
      boardRef.current?.scrollTo({
        top: boardRef.current.scrollHeight,
        behavior
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [lastJobKey]);

  return (
    <section className="generation-page conversation-page mode-agent">
      <div className="workspace-toolbar conversation-toolbar">
        <div className="conversation-mobile-controls">
          <ConversationManager
            conversations={props.conversations}
            currentId={props.conversationId}
            busy={props.conversationBusy}
            onCreate={props.onCreateConversation}
            onSelect={props.onConversationSelect}
            onRename={props.onConversationRename}
            onDelete={props.onConversationDelete}
          />
          <button
            type="button"
            className="button button-secondary conversation-task-button"
            onClick={() => setTaskDialogOpen(true)}
          >
            <Icon name="library" size={15} />
            任务
            <span>{props.jobs.length}</span>
          </button>
        </div>
        <ConversationModelSelectors
          image={{
            providers: props.imageProviders,
            models: props.imageModels,
            modelId: props.imageModelId,
            onModelChange: props.onImageModelChange
          }}
          model={{
            providers: props.modelProviders,
            models: props.modelModels,
            modelId: props.modelModelId,
            onModelChange: props.onModelModelChange
          }}
        />
      </div>

      <div className="workspace-layout conversation-workspace-layout">
        <div className="board-column" ref={boardRef}>
          <GenerationBoard
            jobs={imageJobs}
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
        <div className="agent-side" style={{ width: props.agentPanelWidth }}>
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
          <button type="button" className="agent-setup-notice" onClick={props.onOpenSettings}>
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
          onOpenAssets={() => setAssetPickerOpen(true)}
          onSubmit={props.onSubmit}
        />
      </div>

      {assetPickerOpen && (
        <AssetPickerDialog
          assets={props.assets.filter((asset) => asset.kind === "image")}
          attachmentOrder={props.attachmentOrder}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={props.onToggleAttachment}
          onPreview={(asset) => props.onPreview(asset.id, asset.name)}
          onUploadClick={props.onUploadClick}
          onClose={() => setAssetPickerOpen(false)}
          title="选择对话素材"
          description="可选择上传素材或生成图片，选择后加入本轮对话"
        />
      )}

      <ConversationTaskDialog
        open={taskDialogOpen}
        imageJobs={imageJobs}
        modelJobs={modelJobs}
        assetsById={props.assetsById}
        modelAssetsById={modelAssetsById}
        attachmentOrder={props.attachmentOrder}
        contentUrl={props.contentUrl}
        thumbnailUrl={props.thumbnailUrl}
        onToggleAttachment={props.onToggleGeneratedAttachment}
        onPreview={(assetId) => props.onPreview(assetId)}
        onRetry={props.onRetryJob}
        onDismiss={props.onDismissJob}
        onEdit={props.onEditJob}
        onViewModel={props.onViewModel}
        onClose={() => setTaskDialogOpen(false)}
      />
    </section>
  );
}
