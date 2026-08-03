import { useState } from "react";
import type { AssetSnapshot } from "@lyra/contracts";
import { AssetPickerDialog } from "../../components/AssetPickerDialog.js";
import { Icon } from "../../components/Icon.js";

type InputRole = "model" | "texture";

interface ModelImageInputsProps {
  images: AssetSnapshot[];
  selectedInputImage: AssetSnapshot | undefined;
  selectedTextureImage: AssetSnapshot | undefined;
  supportsTextureImage: boolean;
  textureEnabled: boolean;
  thumbnailUrl: (assetId: string) => string;
  onImageSelect: (assetId: string) => void;
  onTextureImageSelect: (assetId: string) => void;
  onClearTextureImage: () => void;
}

export function ModelImageInputs(props: ModelImageInputsProps) {
  const [pickerRole, setPickerRole] = useState<InputRole | null>(null);
  const selectedAsset = pickerRole === "texture"
    ? props.selectedTextureImage
    : props.selectedInputImage;

  function selectAsset(asset: AssetSnapshot) {
    if (pickerRole === "texture") {
      props.onTextureImageSelect(asset.id);
    } else {
      props.onImageSelect(asset.id);
    }
    setPickerRole(null);
  }

  return (
    <section className="modeling-image-inputs" aria-label="模型输入图片">
      <header>
        <strong>输入图片</strong>
        <span>在这里选择本次建模使用的原图和纹理图</span>
      </header>
      <div className="modeling-input-fields">
        <ModelImageField
          label="模型输入图"
          required
          asset={props.selectedInputImage}
          thumbnailUrl={props.thumbnailUrl}
          onSelect={() => setPickerRole("model")}
        />
        {props.supportsTextureImage && (
          <ModelImageField
            label="纹理输入图"
            asset={props.selectedTextureImage}
            thumbnailUrl={props.thumbnailUrl}
            disabled={!props.textureEnabled}
            optional
            onSelect={() => setPickerRole("texture")}
            {...(props.selectedTextureImage
              ? { onClear: props.onClearTextureImage }
              : {})}
          />
        )}
      </div>
      {!props.selectedInputImage && (
        <p className="modeling-input-note">模型输入图为必选项；点击选择图片后可按来源和名称筛选。</p>
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
  onSelect: () => void;
  onClear?: () => void;
}) {
  return (
    <div className={`modeling-image-field${props.disabled ? " disabled" : ""}`}>
      <div className="modeling-image-field-label">
        <span>{props.label}{props.required && <em>*</em>}</span>
        {props.optional && <small>可选</small>}
      </div>
      <button
        type="button"
        className="modeling-image-field-button"
        aria-label={`${props.asset ? "更换" : "选择"}${props.label}`}
        disabled={props.disabled}
        onClick={props.onSelect}
      >
        {props.asset ? (
          <img src={props.thumbnailUrl(props.asset.id)} alt={props.asset.name} />
        ) : (
          <span className="modeling-image-field-placeholder"><Icon name="image" size={18} /></span>
        )}
        <span className="modeling-image-field-copy">
          <strong title={props.asset?.name}>{props.asset?.name ?? "未选择图片"}</strong>
          <small>{props.disabled ? "启用纹理后可选" : props.asset ? (props.asset.source === "upload" ? "上传素材" : "生成图片") : "点击选择"}</small>
        </span>
        <span className="modeling-image-field-action">{props.asset ? "更换" : "选择"}</span>
      </button>
      {props.onClear && (
        <button type="button" className="modeling-image-field-clear" onClick={props.onClear}>
          清除纹理输入图
        </button>
      )}
    </div>
  );
}
