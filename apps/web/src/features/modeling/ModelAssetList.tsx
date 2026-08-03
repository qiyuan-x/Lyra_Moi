import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { ModelJobCard } from "./ModelJobCard.js";

interface ModelAssetListProps {
  assets: AssetSnapshot[];
  jobs: JobSnapshot[];
  images: AssetSnapshot[];
  selectedAssetId: string;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onSelect: (assetId: string) => void;
}

/** The model history and model files share one list so a finished task is immediately viewable. */
export function ModelAssetList(props: ModelAssetListProps) {
  const imagesById = new Map(props.images.map((asset) => [asset.id, asset]));
  const modelAssetsById = new Map(props.assets.map((asset) => [asset.id, asset]));
  const jobs = [...props.jobs].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );

  return (
    <aside className="modeling-model-list-panel">
      <header>
        <div>
          <strong>AI 模型</strong>
          <span>{jobs.length} 个任务</span>
        </div>
      </header>
      <div className="modeling-model-list">
        {jobs.map((job) => (
          <ModelJobCard
            key={job.id}
            job={job}
            source={imagesById.get(job.inputs[0]?.assetId ?? "")}
            textureSource={imagesById.get(job.inputs[1]?.assetId ?? "")}
            outputs={job.outputs.flatMap((output) => {
              const asset = modelAssetsById.get(output.assetId);
              return asset ? [asset] : [];
            })}
            selectedAssetId={props.selectedAssetId}
            thumbnailUrl={props.thumbnailUrl}
            contentUrl={props.contentUrl}
            onCancel={props.onCancel}
            onRetry={props.onRetry}
            onDismiss={props.onDismiss}
            onSelectOutput={props.onSelect}
          />
        ))}
        {jobs.length === 0 && (
          <div className="modeling-model-empty">
            <Icon name="cube" size={25} />
            <span>创建建模任务后会显示在这里</span>
          </div>
        )}
      </div>
    </aside>
  );
}
