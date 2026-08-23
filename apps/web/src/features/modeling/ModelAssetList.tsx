import { useMemo, useState } from "react";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Icon } from "../../components/Icon.js";
import { ModelJobCard } from "./ModelJobCard.js";

interface ModelAssetListProps {
  assets: AssetSnapshot[];
  jobs: JobSnapshot[];
  images: AssetSnapshot[];
  selectedAssetId: string;
  expanded: boolean;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onDeleteModel: (assetIds: string[]) => Promise<void>;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (assetId: string) => void;
}

interface PendingModelDelete {
  title: string;
  assetIds: string[];
}

/** Generated models and in-progress model jobs share one compact list. */
export function ModelAssetList(props: ModelAssetListProps) {
  const [deleting, setDeleting] = useState<PendingModelDelete | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const imagesById = useMemo(
    () => new Map(props.images.map((asset) => [asset.id, asset])),
    [props.images]
  );
  const modelAssetsById = useMemo(
    () => new Map(props.assets.map((asset) => [asset.id, asset])),
    [props.assets]
  );
  const jobs = useMemo(
    () => [...props.jobs]
      .filter((job) => job.status !== "succeeded" || job.outputs.some((output) => modelAssetsById.has(output.assetId)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [modelAssetsById, props.jobs]
  );
  const completedModelCount = jobs.filter((job) => job.status === "succeeded").length;

  return (
    <>
      <aside className={`modeling-model-list-panel ${props.expanded ? "list-expanded" : "list-collapsed"}`}>
        <header>
          <div>
            <strong>AI 模型</strong>
            <span>{completedModelCount} 个模型</span>
          </div>
          <button
            type="button"
            className="icon-button modeling-model-list-toggle"
            aria-label={props.expanded ? "收起 AI 模型" : "展开 AI 模型"}
            aria-expanded={props.expanded}
            onClick={() => props.onExpandedChange(!props.expanded)}
          >
            <Icon name="chevron" size={16} />
          </button>
        </header>
        <div className="modeling-model-list">
          {jobs.map((job) => {
            const outputs = job.outputs.flatMap((output) => {
              const asset = modelAssetsById.get(output.assetId);
              return asset ? [asset] : [];
            });
            return (
              <ModelJobCard
                key={job.id}
                job={job}
                source={imagesById.get(
                  job.inputs.find((input) => input.label === "模型输入图")?.assetId ?? ""
                )}
                textureSource={imagesById.get(
                  job.inputs.find((input) => input.label === "纹理输入图")?.assetId ?? ""
                )}
                outputs={outputs}
                selectedAssetId={props.selectedAssetId}
                thumbnailUrl={props.thumbnailUrl}
                contentUrl={props.contentUrl}
                onCancel={props.onCancel}
                onRetry={props.onRetry}
                onDismiss={props.onDismiss}
                onDelete={() => setDeleting({
                  title: job.prompt || job.title || "AI 模型",
                  assetIds: outputs.map((asset) => asset.id)
                })}
                onSelectOutput={props.onSelect}
              />
            );
          })}
          {jobs.length === 0 && (
            <div className="modeling-model-empty">
              <Icon name="cube" size={25} />
              <span>创建建模任务后会显示在这里</span>
            </div>
          )}
        </div>
      </aside>

      {deleting && (
        <ConfirmDialog
          title="删除模型"
          text={`确认删除“${deleting.title}”？该模型的所有输出格式文件都会从项目中移除。`}
          confirmText="确认删除"
          busy={deleteBusy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setDeleteBusy(true);
            try {
              await props.onDeleteModel(deleting.assetIds);
              setDeleting(null);
            } finally {
              setDeleteBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
