import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";

interface PromptPreviewPickerDialogProps {
  images: AssetSnapshot[];
  selectedId: string;
  currentPreview: { name: string; url: string } | null;
  thumbnailUrl: (assetId: string) => string;
  onClose: () => void;
  onConfirm: (selectedId: string) => void;
}

export function PromptPreviewPickerDialog(props: PromptPreviewPickerDialogProps) {
  const [selectedId, setSelectedId] = useState(props.selectedId);
  const [search, setSearch] = useState("");
  const filteredImages = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return props.images;
    return props.images.filter((image) =>
      image.name.toLocaleLowerCase("zh-CN").includes(keyword) ||
      image.originalName?.toLocaleLowerCase("zh-CN").includes(keyword)
    );
  }, [props.images, search]);

  return createPortal(
    <div className="modal-backdrop prompt-preview-picker-backdrop" onMouseDown={props.onClose}>
      <div
        className="form-modal prompt-preview-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-preview-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="prompt-preview-picker-title">选择效果图</strong>
            <span>从当前项目已生成的图片中选择</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="prompt-preview-picker-toolbar">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索图片名称"
            autoFocus
          />
          <span>共 {props.images.length} 张</span>
        </div>
        <div className="prompt-preview-picker-grid">
          <PreviewOption
            selected={selectedId === "__none"}
            name="不使用效果图"
            onClick={() => setSelectedId("__none")}
          />
          {props.currentPreview && (
            <PreviewOption
              selected={selectedId === "__keep"}
              name="保留当前效果图"
              imageUrl={props.currentPreview.url}
              onClick={() => setSelectedId("__keep")}
            />
          )}
          {filteredImages.map((image) => (
            <PreviewOption
              key={image.id}
              selected={selectedId === image.id}
              name={image.name}
              imageUrl={props.thumbnailUrl(image.id)}
              onClick={() => setSelectedId(image.id)}
            />
          ))}
          {search.trim() && filteredImages.length === 0 && (
            <p className="prompt-preview-picker-empty">没有找到匹配的图片。</p>
          )}
        </div>
        <footer>
          <button type="button" className="button button-secondary" onClick={props.onClose}>
            取消
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => props.onConfirm(selectedId)}
          >
            确定
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function PreviewOption(props: {
  selected: boolean;
  name: string;
  imageUrl?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`prompt-preview-option${props.selected ? " selected" : ""}`}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="prompt-preview-option-image">
        {props.imageUrl
          ? <img src={props.imageUrl} alt="" loading="lazy" />
          : <Icon name="image" size={28} />}
        {props.selected && (
          <span className="prompt-preview-option-check"><Icon name="confirm" size={14} /></span>
        )}
      </span>
      <strong title={props.name}>{props.name}</strong>
    </button>
  );
}
