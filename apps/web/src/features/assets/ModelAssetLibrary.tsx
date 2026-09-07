import { useMemo, useState } from "react";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Icon } from "../../components/Icon.js";
import { DownloadAssetsButton } from "./DownloadAssetsButton.js";

interface ModelAssetLibraryProps {
  jobs: JobSnapshot[];
  images: AssetSnapshot[];
  modelAssets: AssetSnapshot[];
  search: string;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onView: (assetId: string) => void;
  onDelete: (assetIds: string[]) => Promise<void>;
}

export function ModelAssetLibrary(props: ModelAssetLibraryProps) {
  const [deleting, setDeleting] = useState<{ title: string; assetIds: string[] } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const imagesById = useMemo(
    () => new Map(props.images.map((asset) => [asset.id, asset])),
    [props.images]
  );
  const modelAssetsById = useMemo(
    () => new Map(props.modelAssets.map((asset) => [asset.id, asset])),
    [props.modelAssets]
  );
  const entries = useMemo(() => {
    const needle = props.search.trim().toLocaleLowerCase("zh-CN");
    return props.jobs
      .filter((job) => job.kind === "model.generate")
      .map((job) => ({
        job,
        source: imagesById.get(
          job.inputs.find((input) => input.label === "模型输入图")?.assetId ?? ""
        ),
        outputs: job.outputs.flatMap((output) => {
          const asset = modelAssetsById.get(output.assetId);
          return asset ? [asset] : [];
        })
      }))
      .filter((entry) => entry.outputs.length > 0)
      .filter((entry) => {
        if (!needle) return true;
        return [
          entry.source?.name,
          entry.job.prompt,
          entry.job.title,
          entry.job.providerName,
          entry.job.remoteModelId,
          ...entry.outputs.map((asset) => asset.name)
        ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN").includes(needle);
      })
      .sort((left, right) => right.job.createdAt.localeCompare(left.job.createdAt));
  }, [imagesById, modelAssetsById, props.jobs, props.search]);
  // A project directory can be restored without its historical job rows. Keep
  // the model assets visible in that case instead of reporting an empty
  // library. The asset itself remains usable for preview/download.
  const orphanAssets = useMemo(() => {
    const related = new Set(entries.flatMap((entry) => entry.outputs.map((asset) => asset.id)));
    const needle = props.search.trim().toLocaleLowerCase("zh-CN");
    return props.modelAssets.filter((asset) => {
      if (related.has(asset.id)) return false;
      if (!needle) return true;
      return `${asset.name} ${asset.originalName ?? ""} ${asset.tags.join(" ")}`
        .toLocaleLowerCase("zh-CN").includes(needle);
    });
  }, [entries, props.modelAssets, props.search]);

  if (entries.length === 0 && orphanAssets.length === 0) {
    return (
      <div className="library-empty">
        <Icon name="cube" size={28} />
        <strong>没有符合条件的 AI 模型</strong>
        <span>完成 AI 建模任务后，模型会自动显示在这里。</span>
      </div>
    );
  }

  return (
    <>
      <div className="model-library-grid">
      {entries.map(({ job, source, outputs }) => {
        const glb = outputs.find((asset) => asset.mimeType === "model/gltf-binary");
        const title = source?.name ?? job.prompt ?? job.title;
        return (
          <article className="model-library-card" key={job.id}>
            <div className="model-library-preview">
              {source ? (
                <img src={props.thumbnailUrl(source.id)} alt={source.name} loading="lazy" />
              ) : (
                <span><Icon name="cube" size={30} /></span>
              )}
              <b>{job.prompt ? "文字生成" : "图片生成"}</b>
            </div>
            <div className="model-library-copy">
              <strong title={title}>{title}</strong>
              <span title={`${job.providerName} / ${job.remoteModelId}`}>
                {job.providerName} / {job.remoteModelId}
              </span>
              <small>{formatDate(job.finishedAt ?? job.updatedAt)}</small>
            </div>
            <div className="model-library-formats" aria-label="模型输出格式">
              {outputs.map((asset) => (
                <span key={asset.id}>{formatFromAsset(asset)}</span>
              ))}
            </div>
            <footer>
              <button
                type="button"
                className="button button-primary"
                disabled={!glb}
                onClick={() => glb && props.onView(glb.id)}
              >
                <Icon name="cube" size={14} />查看模型
              </button>
              <DownloadAssetsButton assets={outputs} contentUrl={props.contentUrl} label="下载模型" archiveName={title} />
              <button
                type="button"
                className="icon-button danger-button"
                title="删除模型"
                aria-label={`删除模型 ${title}`}
                onClick={() => setDeleting({
                  title,
                  assetIds: outputs.map((asset) => asset.id)
                })}
              >
                <Icon name="trash" size={14} />
              </button>
            </footer>
          </article>
        );
      })}
      {orphanAssets.map((asset) => (
        <article className="model-library-card" key={`orphan-${asset.id}`}>
          <div className="model-library-preview">
            <span><Icon name="cube" size={30} /></span>
            <b>项目素材</b>
          </div>
          <div className="model-library-copy">
            <strong title={asset.name}>{asset.name}</strong>
            <span>未关联历史任务</span>
            <small>{formatDate(asset.createdAt)}</small>
          </div>
          <div className="model-library-formats" aria-label="模型输出格式">
            <span>{formatFromAsset(asset)}</span>
          </div>
          <footer>
            <button type="button" className="button button-primary" onClick={() => props.onView(asset.id)}>
              <Icon name="cube" size={14} />查看模型
            </button>
            <DownloadAssetsButton assets={[asset]} contentUrl={props.contentUrl} label="下载模型" archiveName={asset.name} />
            <button type="button" className="icon-button danger-button" title="删除模型" aria-label={`删除模型 ${asset.name}`} onClick={() => setDeleting({ title: asset.name, assetIds: [asset.id] })}>
              <Icon name="trash" size={14} />
            </button>
          </footer>
        </article>
      ))}
      </div>
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
              await props.onDelete(deleting.assetIds);
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

export function countCompletedModels(
  _jobs: JobSnapshot[],
  modelAssets: AssetSnapshot[]
): number {
  // Count stored model assets, not only jobs. Imported/restored project
  // folders may intentionally have no historical job rows.
  return modelAssets.length;
}

function formatFromAsset(asset: AssetSnapshot): string {
  if (asset.mimeType === "model/gltf-binary") return "GLB";
  const tagged = asset.tags.find((tag) =>
    ["OBJ", "FBX", "STL", "USDZ", "3MF"].includes(tag.toUpperCase())
  );
  if (tagged) return tagged.toUpperCase();
  const match = asset.name.match(/\.([A-Za-z0-9]+)$/u);
  return match?.[1]?.toUpperCase() ?? "MODEL";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
