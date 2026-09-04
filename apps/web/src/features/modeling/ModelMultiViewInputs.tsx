import {
  useEffect,
  useState,
  type ClipboardEvent,
  type DragEvent
} from "react";
import type { AssetSnapshot, ModelViewType } from "@lyra/contracts";
import { AssetPickerDialog } from "../../components/AssetPickerDialog.js";
import { Icon } from "../../components/Icon.js";

export type ModelViewOption = {
  view: ModelViewType;
  label: string;
  required?: boolean;
};

export function ModelMultiViewInputs(props: {
  views: ModelViewOption[];
  minimumImages: number;
  images: AssetSnapshot[];
  selected: Partial<Record<ModelViewType, AssetSnapshot>>;
  thumbnailUrl: (assetId: string) => string;
  onSelect: (view: ModelViewType, assetId: string) => void;
  onClear: (view: ModelViewType) => void;
  onUpload: (files: File[]) => Promise<AssetSnapshot[]>;
}) {
  const [pickerView, setPickerView] = useState<ModelViewType | null>(null);
  const [activeView, setActiveView] = useState<ModelViewType>("front");
  const [uploadingView, setUploadingView] = useState<ModelViewType | null>(null);
  const [dragView, setDragView] = useState<ModelViewType | null>(null);

  useEffect(() => {
    const pasteImage = (event: globalThis.ClipboardEvent) => {
      const files = imageFiles(Array.from(event.clipboardData?.files ?? []));
      if (files.length === 0) return;
      event.preventDefault();
      void uploadFiles(activeView, files);
    };
    document.addEventListener("paste", pasteImage);
    return () => document.removeEventListener("paste", pasteImage);
  }, [activeView, props.onUpload, uploadingView]);

  async function uploadFiles(view: ModelViewType, files: File[]) {
    const images = imageFiles(files);
    if (images.length === 0 || uploadingView) return;
    setActiveView(view);
    setUploadingView(view);
    try {
      const uploaded = await props.onUpload(images);
      if (uploaded[0]) props.onSelect(view, uploaded[0].id);
    } finally {
      setUploadingView(null);
      setDragView(null);
    }
  }

  function dropFiles(view: ModelViewType, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void uploadFiles(view, Array.from(event.dataTransfer.files));
  }

  function pasteFiles(view: ModelViewType, event: ClipboardEvent<HTMLDivElement>) {
    const files = imageFiles(Array.from(event.clipboardData.files));
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadFiles(view, files);
  }

  return (
    <section className="modeling-image-inputs modeling-multiview-inputs" aria-label="多视图输入图片">
      <header>
        <strong>多视图图片</strong>
        <span>{props.minimumImages === 1 ? "可选择 1 至 4 张图片" : "至少选择正面图和另一张视图"}</span>
      </header>
      <div className="modeling-input-fields">
        {props.views.map((option) => {
          const asset = props.selected[option.view];
          const uploading = uploadingView === option.view;
          return (
            <div
              key={option.view}
              className={`modeling-image-field${dragView === option.view ? " drag-active" : ""}`}
              onFocus={() => setActiveView(option.view)}
              onPointerDown={() => setActiveView(option.view)}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragView(option.view);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragView(null);
                }
              }}
              onDrop={(event) => dropFiles(option.view, event)}
              onPaste={(event) => pasteFiles(option.view, event)}
            >
              <div className="modeling-image-field-label">
                <span>{option.label}{option.required && <em>*</em>}</span>
                {!option.required && <small>可选</small>}
              </div>
              <button
                type="button"
                className="modeling-image-field-button"
                disabled={uploading}
                onClick={() => {
                  setActiveView(option.view);
                  setPickerView(option.view);
                }}
              >
                {asset ? (
                  <img src={props.thumbnailUrl(asset.id)} alt={asset.name} />
                ) : (
                  <span className="modeling-image-field-placeholder"><Icon name="image" size={18} /></span>
                )}
                <span className="modeling-image-field-copy">
                  <strong title={asset?.name}>{uploading ? "正在上传" : asset?.name ?? "未选择图片"}</strong>
                  <small>{uploading ? "请稍候" : asset ? (asset.source === "upload" ? "上传素材" : "生成图片") : "点击选择，或拖入、粘贴图片"}</small>
                </span>
                <span className="modeling-image-field-action">{uploading ? "上传中" : asset ? "更换" : "选择"}</span>
              </button>
              {asset && (
                <button
                  type="button"
                  className="modeling-image-field-clear"
                  onClick={() => props.onClear(option.view)}
                  disabled={uploading}
                >
                  清除{option.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {pickerView && (
        <AssetPickerDialog
          assets={props.images}
          attachmentOrder={new Map(props.selected[pickerView]
            ? [[props.selected[pickerView]!.id, 1]]
            : [])}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={(asset) => {
            props.onSelect(pickerView, asset.id);
            setPickerView(null);
          }}
          onClose={() => setPickerView(null)}
          title={`选择${props.views.find((option) => option.view === pickerView)?.label ?? "视图图片"}`}
          description="可选择当前项目中的上传素材或生成图片"
          submitLabel="关闭"
          selectionMode="single"
        />
      )}
    </section>
  );
}

function imageFiles(files: File[]): File[] {
  return files.filter((file) => file.type.startsWith("image/"));
}
