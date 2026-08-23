import {
  useEffect,
  useState,
  type ClipboardEvent,
  type DragEvent
} from "react";
import type { AssetSnapshot } from "@lyra/contracts";
import { AssetPickerDialog } from "../../components/AssetPickerDialog.js";
import { Icon } from "../../components/Icon.js";

type InputRole = "model" | "texture";

interface ModelImageInputsProps {
  showModelInput?: boolean;
  images: AssetSnapshot[];
  selectedInputImage: AssetSnapshot | undefined;
  selectedTextureImage: AssetSnapshot | undefined;
  supportsTextureImage: boolean;
  textureEnabled: boolean;
  thumbnailUrl: (assetId: string) => string;
  onImageSelect: (assetId: string) => void;
  onTextureImageSelect: (assetId: string) => void;
  onClearImage: () => void;
  onClearTextureImage: () => void;
  onUpload: (files: File[]) => Promise<AssetSnapshot[]>;
}

export function ModelImageInputs(props: ModelImageInputsProps) {
  const [pickerRole, setPickerRole] = useState<InputRole | null>(null);
  const [activeRole, setActiveRole] = useState<InputRole>(
    props.showModelInput === false ? "texture" : "model"
  );
  const [uploadingRole, setUploadingRole] = useState<InputRole | null>(null);
  const [dragRole, setDragRole] = useState<InputRole | null>(null);
  const selectedAsset = pickerRole === "texture"
    ? props.selectedTextureImage
    : props.selectedInputImage;

  useEffect(() => {
    if (props.showModelInput === false) setActiveRole("texture");
  }, [props.showModelInput]);

  useEffect(() => {
    const pasteImage = (event: globalThis.ClipboardEvent) => {
      const files = imageFiles(Array.from(event.clipboardData?.files ?? []));
      if (files.length === 0) return;
      event.preventDefault();
      void uploadFiles(activeRole, files);
    };
    document.addEventListener("paste", pasteImage);
    return () => document.removeEventListener("paste", pasteImage);
  }, [activeRole, props.onUpload, uploadingRole]);

  function selectAsset(asset: AssetSnapshot) {
    if (pickerRole === "texture") {
      props.onTextureImageSelect(asset.id);
    } else {
      props.onImageSelect(asset.id);
    }
    setPickerRole(null);
  }

  async function uploadFiles(role: InputRole, files: File[]) {
    const images = imageFiles(files);
    if (images.length === 0 || uploadingRole) return;
    if (role === "model" && props.showModelInput === false) return;
    if (role === "texture" && (!props.supportsTextureImage || !props.textureEnabled)) return;
    setActiveRole(role);
    setUploadingRole(role);
    try {
      const uploaded = await props.onUpload(images);
      const asset = uploaded[0];
      if (!asset) return;
      if (role === "texture") {
        props.onTextureImageSelect(asset.id);
      } else {
        props.onImageSelect(asset.id);
      }
    } finally {
      setUploadingRole(null);
      setDragRole(null);
    }
  }

  function dropFiles(role: InputRole, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void uploadFiles(role, Array.from(event.dataTransfer.files));
  }

  function pasteFiles(role: InputRole, event: ClipboardEvent<HTMLDivElement>) {
    const files = imageFiles(Array.from(event.clipboardData.files));
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadFiles(role, files);
  }

  return (
    <section className="modeling-image-inputs" aria-label="模型输入图片">
      <header>
        <strong>{props.showModelInput === false ? "纹理输入图" : "输入图片"}</strong>
        <span>
          {props.showModelInput === false
            ? "可选，仅 Meshy 支持为文字生成单独提供纹理输入图"
            : "选择本次建模使用的模型输入图和可选纹理图"}
        </span>
      </header>
      <div className="modeling-input-fields">
        {props.showModelInput !== false && (
          <ModelImageField
            label="模型输入图"
            required
            asset={props.selectedInputImage}
            thumbnailUrl={props.thumbnailUrl}
            uploading={uploadingRole === "model"}
            dragging={dragRole === "model"}
            onActivate={() => setActiveRole("model")}
            onSelect={() => {
              setActiveRole("model");
              setPickerRole("model");
            }}
            {...(props.selectedInputImage
              ? { onClear: props.onClearImage }
              : {})}
            onDragEnter={() => setDragRole("model")}
            onDragLeave={() => setDragRole(null)}
            onDrop={(event) => dropFiles("model", event)}
            onPaste={(event) => pasteFiles("model", event)}
          />
        )}
        {props.supportsTextureImage && (
          <ModelImageField
            label="纹理输入图"
            asset={props.selectedTextureImage}
            thumbnailUrl={props.thumbnailUrl}
            disabled={!props.textureEnabled}
            optional
            uploading={uploadingRole === "texture"}
            dragging={dragRole === "texture"}
            onActivate={() => setActiveRole("texture")}
            onSelect={() => {
              setActiveRole("texture");
              setPickerRole("texture");
            }}
            onDragEnter={() => setDragRole("texture")}
            onDragLeave={() => setDragRole(null)}
            onDrop={(event) => dropFiles("texture", event)}
            onPaste={(event) => pasteFiles("texture", event)}
            {...(props.selectedTextureImage
              ? { onClear: props.onClearTextureImage }
              : {})}
          />
        )}
      </div>
      {props.showModelInput !== false && !props.selectedInputImage && (
        <p className="modeling-input-note">模型输入图为必选项；可从素材库选择，也可拖入或粘贴图片。</p>
      )}
      {pickerRole && (
        <AssetPickerDialog
          assets={props.images}
          attachmentOrder={new Map(selectedAsset ? [[selectedAsset.id, 1]] : [])}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={selectAsset}
          onClose={() => setPickerRole(null)}
          title={pickerRole === "texture" ? "选择纹理输入图" : "选择模型输入图"}
          description="可选择当前项目中的上传素材或生成图片"
          submitLabel="关闭"
          selectionMode="single"
        />
      )}
    </section>
  );
}

function ModelImageField(props: {
  label: string;
  required?: boolean;
  optional?: boolean;
  asset: AssetSnapshot | undefined;
  thumbnailUrl: (assetId: string) => string;
  disabled?: boolean;
  uploading?: boolean;
  dragging?: boolean;
  onActivate: () => void;
  onSelect: () => void;
  onClear?: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`modeling-image-field${props.disabled ? " disabled" : ""}${props.dragging ? " drag-active" : ""}`}
      onFocus={props.onActivate}
      onPointerDown={props.onActivate}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!props.disabled) props.onDragEnter();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          props.onDragLeave();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (props.disabled) return;
        props.onDrop(event);
      }}
      onPaste={props.onPaste}
    >
      <div className="modeling-image-field-label">
        <span>{props.label}{props.required && <em>*</em>}</span>
        {props.optional && <small>可选</small>}
      </div>
      <button
        type="button"
        className="modeling-image-field-button"
        aria-label={`${props.asset ? "更换" : "选择"}${props.label}`}
        disabled={props.disabled || props.uploading}
        onClick={props.onSelect}
      >
        {props.asset ? (
          <img src={props.thumbnailUrl(props.asset.id)} alt={props.asset.name} />
        ) : (
          <span className="modeling-image-field-placeholder"><Icon name="image" size={18} /></span>
        )}
        <span className="modeling-image-field-copy">
          <strong title={props.asset?.name}>{props.uploading ? "正在上传" : props.asset?.name ?? "未选择图片"}</strong>
          <small>{props.disabled ? "启用纹理后可选" : props.uploading ? "请稍候" : props.asset ? (props.asset.source === "upload" ? "上传素材" : "生成图片") : "点击选择，或拖入、粘贴图片"}</small>
        </span>
        <span className="modeling-image-field-action">{props.uploading ? "上传中" : props.asset ? "更换" : "选择"}</span>
      </button>
      {props.onClear && (
        <button type="button" className="modeling-image-field-clear" onClick={props.onClear} disabled={props.uploading}>
          清除{props.label}
        </button>
      )}
    </div>
  );
}

function imageFiles(files: File[]): File[] {
  return files.filter((file) => file.type.startsWith("image/"));
}
