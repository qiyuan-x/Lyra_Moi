import { useEffect, useRef } from "react";
import type {
  AssetSnapshot,
  JobSnapshot,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import { AssetRail } from "../components/AssetRail.js";
import { GenerationBoard } from "../components/GenerationBoard.js";
import { ImageGenerationPanel } from "../features/generation/ImageGenerationPanel.js";
import { ProviderModelSelects } from "../features/providers/ProviderModelSelects.js";
import type { ManualImageTaskInput } from "../features/generation/task-input.js";

interface ImageGenerationPageProps {
  projectId: string;
  imageModelId: string;
  imageProviders: Array<{ id: string; name: string }>;
  imageModels: Array<{ id: string; providerId: string; name: string }>;
  onImageModelChange: (modelId: string) => void;
  editingJob: JobSnapshot | null;
  promptTemplates: PromptTemplateSnapshot[];
  submitting: boolean;
  attachments: AssetSnapshot[];
  onAttachmentsChange: (assets: AssetSnapshot[]) => void;
  onCancelEdit: () => void;
  onSubmit: (input: ManualImageTaskInput) => Promise<void>;
  onUpload: (files: File[]) => Promise<void>;
  onUploadClick: () => void;
  assetRailCollapsed: boolean;
  assets: AssetSnapshot[];
  generationModelByAssetId: Map<string, string>;
  assetsById: Map<string, AssetSnapshot>;
  attachmentOrder: Map<string, number>;
  jobs: JobSnapshot[];
  contentUrl: (assetId: string) => string;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (asset: AssetSnapshot) => void;
  onToggleGeneratedAttachment: (assetId: string) => Promise<void>;
  onToggleAssetRail: () => void;
  onPreview: (assetId: string, fallbackName?: string) => void;
  onRetryJob: (jobId: string) => Promise<void>;
  onDismissJob: (jobId: string) => Promise<void>;
  onEditJob: (job: JobSnapshot) => void;
  onError: (error: unknown) => void;
}

export function ImageGenerationPage(props: ImageGenerationPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastJobKeyRef = useRef<string | null>(null);
  const lastJob = props.jobs.at(-1);
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
      const board = boardRef.current;
      if (!board) return;
      if (window.matchMedia("(max-width: 40rem)").matches) {
        if (behavior === "smooth") {
          board.scrollIntoView({ behavior, block: "start" });
        }
      } else {
        board.scrollTo({ top: board.scrollHeight, behavior });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [lastJobKey]);

  useEffect(() => {
    if (!props.editingJob || !window.matchMedia("(max-width: 40rem)").matches) return;
    const frame = requestAnimationFrame(() => {
      pageRef.current
        ?.querySelector<HTMLElement>(".image-generation-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.editingJob?.id]);

  return (
    <section className="generation-page image-generation-page" ref={pageRef}>
      <div className="image-generation-command-bar">
        <strong>手动生成图片</strong>
        <div className="image-generation-command-actions">
          <button
            type="button"
            className="button button-secondary mobile-generation-jobs-button"
            onClick={() => boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            生成记录 {props.jobs.length}
          </button>
          <ProviderModelSelects
            className="image-generation-model-picker"
            providers={props.imageProviders}
            models={props.imageModels}
            modelId={props.imageModelId}
            providerLabel="图片供应商"
            modelLabel="图片模型"
            onModelChange={props.onImageModelChange}
          />
        </div>
      </div>

      <div
        className={`workspace-layout image-generation-layout${
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
          showPickerButton={false}
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
        <ImageGenerationPanel
          projectId={props.projectId}
          editingJob={props.editingJob}
          assets={props.assets}
          attachments={props.attachments}
          promptTemplates={props.promptTemplates}
          modelId={props.imageModelId}
          onModelChange={props.onImageModelChange}
          busy={props.submitting}
          thumbnailUrl={props.thumbnailUrl}
          onAttachmentsChange={props.onAttachmentsChange}
          onPreview={(asset) => props.onPreview(asset.id, asset.name)}
          onUpload={props.onUpload}
          onCancelEdit={props.onCancelEdit}
          onSubmit={props.onSubmit}
        />
      </div>
    </section>
  );
}
