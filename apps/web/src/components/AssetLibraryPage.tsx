import { useMemo, useState, type FormEvent } from "react";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import {
  countCompletedModels,
  ModelAssetLibrary
} from "../features/assets/ModelAssetLibrary.js";

type LibrarySection = "upload" | "generated" | "models";

interface AssetLibraryPageProps {
  assets: AssetSnapshot[];
  modelAssets: AssetSnapshot[];
  jobs: JobSnapshot[];
  generationModelByAssetId: Map<string, string>;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onAttach: (asset: AssetSnapshot) => void;
  onPreview: (asset: AssetSnapshot) => void;
  onViewModel: (assetId: string) => void;
  onUpload: () => void;
  onUpdate: (assetId: string, input: { name: string; tags: string[] }) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
  onDeleteModel: (assetIds: string[]) => Promise<void>;
}

export function AssetLibraryPage(props: AssetLibraryPageProps) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<LibrarySection>("upload");
  const [tag, setTag] = useState("");
  const [editing, setEditing] = useState<AssetSnapshot | null>(null);
  const [deleting, setDeleting] = useState<AssetSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const tags = useMemo(
    () => source === "models"
      ? []
      : [...new Set(props.assets.filter((asset) => asset.source === source).flatMap((asset) => asset.tags))].sort(),
    [props.assets, source]
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    if (source === "models") return [];
    return props.assets.filter((asset) => {
      if (asset.source !== source) return false;
      if (tag && !asset.tags.includes(tag)) return false;
      return !needle || `${asset.name} ${asset.originalName ?? ""} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(needle);
    });
  }, [props.assets, search, source, tag]);
  const modelCount = useMemo(
    () => countCompletedModels(props.jobs, props.modelAssets),
    [props.jobs, props.modelAssets]
  );

  return (
    <section className="library-page">
      <header className="page-heading">
        <div><h1>素材库</h1><p>统一查看当前项目的图片素材、生成图片和 AI 模型。</p></div>
        {source !== "models" && (
          <button type="button" className="button button-primary" onClick={props.onUpload}><Icon name="plus" size={16} />上传图片</button>
        )}
      </header>
      <div className="asset-source-tabs" role="tablist" aria-label="素材分类">
        <button type="button" role="tab" aria-selected={source === "upload"} onClick={() => { setSource("upload"); setTag(""); }}>
          上传素材 <span>{props.assets.filter((asset) => asset.source === "upload").length}</span>
        </button>
        <button type="button" role="tab" aria-selected={source === "generated"} onClick={() => { setSource("generated"); setTag(""); }}>
          生成图片 <span>{props.assets.filter((asset) => asset.source === "generated").length}</span>
        </button>
        <i className="asset-source-divider" aria-hidden="true" />
        <button type="button" role="tab" aria-selected={source === "models"} onClick={() => { setSource("models"); setTag(""); }}>
          AI 模型 <span>{modelCount}</span>
        </button>
      </div>
      <div className="library-filters">
        <label className="search-field"><span>搜索</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={source === "models" ? "名称、供应商或模型" : "名称或标签"} /></label>
        {source !== "models" && (
          <label><span>标签</span><select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部标签</option>{tags.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        )}
        <span className="filter-count">{source === "models" ? modelCount : visible.length} 项</span>
      </div>
      {source === "models" ? (
        <ModelAssetLibrary
          jobs={props.jobs}
          images={props.assets}
          modelAssets={props.modelAssets}
          search={search}
          thumbnailUrl={props.thumbnailUrl}
          contentUrl={props.contentUrl}
          onView={props.onViewModel}
          onDelete={props.onDeleteModel}
        />
      ) : visible.length === 0 ? (
        <div className="library-empty"><Icon name="library" size={28} /><strong>没有符合条件的素材</strong><span>调整筛选条件，或上传新的图片。</span></div>
      ) : (
        <div className="asset-library-grid">
          {visible.map((asset) => (
            <article key={asset.id}>
              <button type="button" className="library-image" onClick={() => props.onPreview(asset)}><img src={props.thumbnailUrl(asset.id)} alt={asset.name} loading="lazy" /></button>
              <div className="asset-card-copy"><strong title={asset.name}>{asset.name}</strong><span>{asset.source === "generated" ? "生成" : "上传"} · {formatBytes(asset.byteSize)}</span></div>
              {props.generationModelByAssetId.has(asset.id) && (
                <span
                  className="library-model-label"
                  title={props.generationModelByAssetId.get(asset.id)}
                >
                  {props.generationModelByAssetId.get(asset.id)}
                </span>
              )}
              {asset.tags.length > 0 && <div className="asset-tag-row">{asset.tags.map((item) => <button type="button" key={item} onClick={() => setTag(item)}>{item}</button>)}</div>}
              <footer>
                <button type="button" className="button button-secondary" onClick={() => props.onAttach(asset)}>引用并生成</button>
                <button type="button" className="icon-button" aria-label={`编辑 ${asset.name}`} onClick={() => setEditing(asset)}><Icon name="manual" size={15} /></button>
                <button type="button" className="icon-button danger-button" aria-label={`删除 ${asset.name}`} onClick={() => setDeleting(asset)}><Icon name="close" size={15} /></button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {editing && <AssetEditDialog asset={editing} busy={busy} onClose={() => setEditing(null)} onSave={async (input) => { setBusy(true); try { await props.onUpdate(editing.id, input); setEditing(null); } catch { /* The parent displays the API error. */ } finally { setBusy(false); } }} />}
      {deleting && (
        <ConfirmDialog
          title="删除素材"
          text={`确认删除“${deleting.name}”？已有对话和历史任务仍保留原始记录。`}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { setBusy(true); try { await props.onDelete(deleting.id); setDeleting(null); } catch { /* The parent displays the API error. */ } finally { setBusy(false); } }}
        />
      )}
    </section>
  );
}

function AssetEditDialog(props: { asset: AssetSnapshot; busy: boolean; onClose: () => void; onSave: (value: { name: string; tags: string[] }) => Promise<void> }) {
  const [name, setName] = useState(props.asset.name);
  const [tags, setTags] = useState(props.asset.tags.join(", "));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    void props.onSave({ name: name.trim(), tags: splitTags(tags) });
  }
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <form className="form-modal compact-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><strong>编辑素材</strong><span>修改名称和自由标签</span></div><button type="button" className="icon-button" onClick={props.onClose}><Icon name="close" size={18} /></button></header>
        <div className="form-body"><label className="field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoFocus /></label><label className="field"><span>标签</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="角色, 参考, 正面" /><small>用逗号分隔多个标签</small></label></div>
        <footer><button type="button" className="button button-secondary" onClick={props.onClose}>取消</button><button type="submit" className="button button-primary" disabled={props.busy || !name.trim()}>{props.busy ? "保存中" : "保存"}</button></footer>
      </form>
    </div>
  );
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(/[,，]/u).map((item) => item.trim()).filter(Boolean))];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
