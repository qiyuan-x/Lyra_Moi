import type { AssetSnapshot } from "@lyra/contracts";
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon.js";
import { AssetPickerDialog } from "./AssetPickerDialog.js";

interface AssetRailProps {
  assets: AssetSnapshot[];
  generationModelByAssetId: Map<string, string>;
  attachmentOrder: Map<string, number>;
  collapsed: boolean;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (asset: AssetSnapshot) => void;
  onToggleCollapsed: () => void;
  onPreview: (asset: AssetSnapshot) => void;
  onUploadClick: () => void;
  showPickerButton?: boolean;
}

export function AssetRail(props: AssetRailProps) {
  const imageAssets = props.assets.filter((asset) => asset.kind === "image");
  const uploaded = imageAssets.filter((asset) => asset.source === "upload");
  const generated = imageAssets.filter((asset) => asset.source === "generated");
  const [pickerSource, setPickerSource] = useState<"all" | "upload" | "generated" | null>(null);

  if (props.collapsed) {
    return (
      <aside className="asset-rail collapsed">
        <button type="button" className="asset-rail-reopen" aria-label="展开图片栏" onClick={props.onToggleCollapsed}>
          <Icon name="library" size={19} />
          <span>{props.assets.length}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="asset-rail">
      <header>
        <div>
          <strong>项目图片</strong>
          <span>{imageAssets.length}</span>
        </div>
        <div className="asset-rail-actions">
          {props.showPickerButton !== false && (
            <button
              type="button"
              className="button button-quiet asset-picker-open"
              onClick={() => setPickerSource("all")}
            >
              <Icon name="library" size={14} />选择引用
            </button>
          )}
          <button type="button" className="icon-button asset-collapse-button" aria-label="收起图片栏" onClick={props.onToggleCollapsed}>
            <Icon name="chevron" size={17} />
          </button>
        </div>
      </header>
      <div className="asset-groups">
        <AssetGroup
          className="asset-group-uploaded"
          title="上传素材"
          assets={uploaded}
          emptyText="上传图片"
          attachmentOrder={props.attachmentOrder}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={props.onToggleAttachment}
          onPreview={props.onPreview}
          action={<div className="asset-group-header-actions">
            <button
              type="button"
              className="icon-button"
              title="选择上传素材"
              aria-label="选择上传素材"
              onClick={() => setPickerSource("upload")}
            >
              <Icon name="library" size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="上传素材" onClick={props.onUploadClick}>
              <Icon name="plus" size={16} />
            </button>
          </div>}
          onEmptyClick={props.onUploadClick}
        />
        <AssetGroup
          title="生成图片"
          assets={generated}
          emptyText="暂无结果"
          attachmentOrder={props.attachmentOrder}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={props.onToggleAttachment}
          onPreview={props.onPreview}
          generationModelByAssetId={props.generationModelByAssetId}
          action={(
            <button
              type="button"
              className="icon-button"
              title="选择生成图片"
              aria-label="选择生成图片"
              onClick={() => setPickerSource("generated")}
            >
              <Icon name="library" size={15} />
            </button>
          )}
        />
      </div>
      {pickerSource && (
        <AssetPickerDialog
          assets={imageAssets}
          initialSource={pickerSource}
          attachmentOrder={props.attachmentOrder}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={props.onToggleAttachment}
          onClose={() => setPickerSource(null)}
          onPreview={props.onPreview}
          onUploadClick={props.onUploadClick}
        />
      )}
    </aside>
  );
}

function AssetGroup(props: {
  className?: string;
  title: string;
  assets: AssetSnapshot[];
  emptyText: string;
  attachmentOrder: Map<string, number>;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (asset: AssetSnapshot) => void;
  onPreview: (asset: AssetSnapshot) => void;
  generationModelByAssetId?: Map<string, string>;
  action?: ReactNode;
  onEmptyClick?: () => void;
}) {
  return (
    <section className={`asset-group${props.className ? ` ${props.className}` : ""}`}>
      <header>
        <div><strong>{props.title}</strong><span>{props.assets.length}</span></div>
        {props.action}
      </header>
      <div className="asset-list">
        {props.assets.length === 0 ? (
          <button
            type="button"
            className="asset-empty"
            disabled={!props.onEmptyClick}
            onClick={props.onEmptyClick}
          >
            {props.onEmptyClick && <Icon name="plus" size={18} />}
            {props.emptyText}
          </button>
        ) : props.assets.slice(0, 6).map((asset) => {
          const order = props.attachmentOrder.get(asset.id);
          const generationModel = props.generationModelByAssetId?.get(asset.id);
          return (
            <div className={`asset-tile${order ? " selected" : ""}`} key={asset.id}>
              <button
                type="button"
                title={`${order ? "取消引用" : "引用"} ${asset.name}`}
                onClick={() => props.onToggleAttachment(asset)}
              >
                <img src={props.thumbnailUrl(asset.id)} alt={asset.name} loading="lazy" />
                {order && <span className="asset-reference-order">图{order}</span>}
                {generationModel && (
                  <span className="asset-model-badge" title={generationModel}>
                    {generationModel}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="asset-expand"
                aria-label={`预览 ${asset.name}`}
                onClick={() => props.onPreview(asset)}
              >
                <Icon name="expand" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
