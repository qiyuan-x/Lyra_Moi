import type { ReactNode } from "react";
import {
  isHunyuan31ModelId,
  resolveModelGenerationAdapter,
  type AssetSnapshot,
  type ModelInputMode,
  type ModelOutputFormat,
  type ProviderAdapterType,
  type ProviderModelSnapshot
} from "@lyra/contracts";
import { ModelImageInputs } from "./ModelImageInputs.js";
import { tripoFaceCountRange } from "./model-provider-config.js";

export function ModelProviderParameters(props: {
  adapter: ProviderAdapterType | null;
  providerAdapter: ProviderAdapterType;
  remoteModelId: string;
  inputMode: ModelInputMode;
  parameters: Record<string, unknown>;
  outputFormats: ModelOutputFormat[];
  models: ProviderModelSnapshot[];
  providerProfileId: string | undefined;
  images: AssetSnapshot[];
  selectedTextureImage: AssetSnapshot | undefined;
  thumbnailUrl: (assetId: string) => string;
  onModelChange: (modelId: string) => void;
  onTextureImageSelect: (assetId: string) => void;
  onClearTextureImage: () => void;
  onUpload: (files: File[]) => Promise<AssetSnapshot[]>;
  onParametersChange: (value: Record<string, unknown>) => void;
  onOutputFormatsChange: (value: ModelOutputFormat[]) => void;
}) {
  const set = (key: string, value: unknown) =>
    props.onParametersChange({ ...props.parameters, [key]: value });
  const bool = (key: string, fallback = false) =>
    typeof props.parameters[key] === "boolean" ? props.parameters[key] as boolean : fallback;
  const text = (key: string, fallback: string) =>
    typeof props.parameters[key] === "string" ? props.parameters[key] as string : fallback;
  const number = (key: string, fallback: number) =>
    typeof props.parameters[key] === "number" ? props.parameters[key] as number : fallback;

  if (props.adapter === "meshy") {
    const smart = props.remoteModelId === "meshy-t1" || props.remoteModelId === "meshy-t2";
    const meshModels = props.models.filter((model) =>
      model.providerProfileId === props.providerProfileId &&
      resolveModelGenerationAdapter(props.providerAdapter, model.remoteModelId) === "meshy"
    );
    const standardModels = meshModels.filter((model) => !isSmartMeshyModel(model.remoteModelId));
    const smartModels = meshModels.filter((model) => isSmartMeshyModel(model.remoteModelId));
    const modelType = smart ? "smart-topology" : "standard";
    const modelsForType = smart ? smartModels : standardModels;
    const selectMeshyType = (value: string) => {
      const candidates = value === "smart-topology" ? smartModels : standardModels;
      const selected = candidates.find((model) => model.remoteModelId === props.remoteModelId) ??
        (value === "smart-topology"
          ? candidates.find((model) => model.remoteModelId === "meshy-t2")
          : candidates.find((model) => model.remoteModelId === "latest") ??
            candidates.find((model) => model.remoteModelId === "meshy-7")) ??
        candidates[0];
      if (selected) props.onModelChange(selected.id);
    };
    const texture = bool("texture", true);
    const remesh = !smart && bool("remesh", props.remoteModelId === "meshy-5");
    const autoSize = bool("autoSize", false);
    const guideMode = text("textureGuideMode", "none");
    const decimationMode = typeof props.parameters.decimationMode === "number"
      ? props.parameters.decimationMode
      : null;
    const targetMaximum = smart ? 15_000 : 300_000;
    const targetFaceCount = typeof props.parameters.targetFaceCount === "number"
      ? props.parameters.targetFaceCount
      : null;
    return (
      <>
        <SelectField label="模型类型" value={modelType} onChange={selectMeshyType}>
          <option value="standard" disabled={standardModels.length === 0}>标准</option>
          <option value="smart-topology" disabled={smartModels.length === 0}>智能拓扑</option>
        </SelectField>
        <SelectField
          label="AI 模型"
          value={props.remoteModelId}
          onChange={(value) => {
            const selected = modelsForType.find((model) => model.remoteModelId === value);
            if (selected) props.onModelChange(selected.id);
          }}
        >
          {modelsForType.length > 0
            ? modelsForType.map((model) => (
              <option key={model.id} value={model.remoteModelId}>
                {meshModelLabel(model.remoteModelId)}
              </option>
            ))
            : <option value={props.remoteModelId}>{meshModelLabel(props.remoteModelId)}</option>}
        </SelectField>
        {props.inputMode !== "multiview" && ["latest", "meshy-7"].includes(props.remoteModelId) && (
          <Toggle label="Ultra 模式" checked={bool("ultraMode", false)} onChange={(checked) => set("ultraMode", checked)} />
        )}
        {(props.inputMode === "image" || props.inputMode === "multiview") && ["latest", "meshy-6", "meshy-7"].includes(props.remoteModelId) && (
          <Toggle label="输入图增强" checked={bool("imageEnhancement", true)} onChange={(checked) => set("imageEnhancement", checked)} />
        )}
        {(props.inputMode === "image" || props.inputMode === "multiview") && !smart && (
          <Toggle
            label="保存重建前模型"
            checked={bool("savePreRemeshedModel", false)}
            disabled={!remesh}
            onChange={(checked) => set("savePreRemeshedModel", checked)}
          />
        )}
        <Toggle label="内容审核" checked={bool("moderation", false)} onChange={(checked) => set("moderation", checked)} />
        {!smart && (
          <Toggle
            label="重建网格"
            checked={remesh}
            onChange={(checked) => props.onParametersChange({
              ...props.parameters,
              remesh: checked,
              ...(!checked
                ? { targetFaceCount: null, decimationMode: null, savePreRemeshedModel: false }
                : {})
            })}
          />
        )}
        <Toggle label="生成纹理" checked={texture} onChange={(checked) =>
          props.onParametersChange({
            ...props.parameters,
            texture: checked,
            ...(!checked
              ? { pbr: false, textureGuideMode: "none", texturePrompt: "" }
              : {})
          })
        } />
        {texture && (
          <>
            <SelectField label="纹理引导" value={guideMode} onChange={(value) => set("textureGuideMode", value)}>
              <option value="none">不使用</option>
              <option value="text">文字引导</option>
              <option value="image">图片引导</option>
            </SelectField>
            {guideMode === "text" && (
              <label className="field">
                <span>纹理提示词</span>
                <textarea
                  rows={3}
                  maxLength={600}
                  value={text("texturePrompt", "")}
                  placeholder="描述需要生成的纹理效果"
                  onChange={(event) => set("texturePrompt", event.target.value)}
                />
                <small>{text("texturePrompt", "").length}/600</small>
              </label>
            )}
            {guideMode === "image" && (
              <ModelImageInputs
                showModelInput={false}
                images={props.images}
                selectedInputImage={undefined}
                selectedTextureImage={props.selectedTextureImage}
                supportsTextureImage
                textureEnabled={texture}
                thumbnailUrl={props.thumbnailUrl}
                onImageSelect={() => undefined}
                onTextureImageSelect={props.onTextureImageSelect}
                onClearImage={() => undefined}
                onClearTextureImage={props.onClearTextureImage}
                onUpload={props.onUpload}
              />
            )}
            <Toggle label="生成 PBR 贴图" checked={bool("pbr", false)} onChange={(checked) => set("pbr", checked)} />
            <SelectField label="纹理分辨率" value={text("textureResolution", "2k")} onChange={(value) => set("textureResolution", value)}>
              <option value="2k">2K</option>
              {!props.remoteModelId.includes("meshy-5") && <option value="4k">4K</option>}
              {!props.remoteModelId.includes("meshy-5") && <option value="8k">8K</option>}
            </SelectField>
            {(props.remoteModelId === "meshy-6" ||
              (props.inputMode === "multiview" && ["latest", "meshy-7"].includes(props.remoteModelId))) && (
              <Toggle label="移除纹理光照" checked={bool("removeLighting", true)} onChange={(checked) => set("removeLighting", checked)} />
            )}
          </>
        )}
        {!smart && remesh && (
          <SelectField label="拓扑" value={text("topology", "triangle")} onChange={(value) => set("topology", value)}>
            <option value="triangle">三角面</option>
            <option value="quad">四边面为主</option>
          </SelectField>
        )}
        {!smart && remesh && (
          <SelectField
            label="自适应减面"
            value={decimationMode === null ? "" : String(decimationMode)}
            onChange={(value) => props.onParametersChange({
              ...props.parameters,
              decimationMode: value ? Number(value) : null,
              ...(value ? { targetFaceCount: null } : {})
            })}
          >
            <option value="">不使用</option>
            <option value="1">超高面数</option>
            <option value="2">高面数</option>
            <option value="3">中等面数</option>
            <option value="4">低面数</option>
          </SelectField>
        )}
        {props.remoteModelId !== "meshy-t1" && (smart || remesh) && decimationMode === null && (
          <>
            <Toggle
              label="指定目标面数"
              checked={targetFaceCount !== null}
              onChange={(checked) =>
                set("targetFaceCount", checked ? smart ? 4_000 : 30_000 : null)
              }
            />
            {targetFaceCount !== null && (
              <NumberField
                label={`目标面数（100–${targetMaximum.toLocaleString()}）`}
                value={targetFaceCount}
                min={100}
                max={targetMaximum}
                step={100}
                onChange={(value) => set("targetFaceCount", value)}
              />
            )}
          </>
        )}
        <SelectField label="角色姿势" value={text("poseMode", "")} onChange={(value) => set("poseMode", value)}>
          <option value="">不指定</option>
          <option value="a-pose">A-Pose</option>
          <option value="t-pose">T-Pose</option>
        </SelectField>
        <Toggle label="自动调整尺寸" checked={autoSize} onChange={(checked) => props.onParametersChange({
          ...props.parameters,
          autoSize: checked,
          ...(!checked ? { multiViewThumbnails: false } : {})
        })} />
        {autoSize && (
          <SelectField label="原点位置" value={text("originAt", "bottom")} onChange={(value) => set("originAt", value)}>
            <option value="bottom">底部</option>
            <option value="center">中心</option>
          </SelectField>
        )}
        {(props.inputMode === "image" || props.inputMode === "multiview") && (
          <Toggle
            label="多视角缩略图"
            checked={bool("multiViewThumbnails", false)}
            disabled={!autoSize}
            onChange={(checked) => set("multiViewThumbnails", checked)}
          />
        )}
        <Toggle label="透明背景缩略图" checked={bool("alphaThumbnail", false)} onChange={(checked) => set("alphaThumbnail", checked)} />
        <OutputFormatChecks
          formats={["glb", "obj", "fbx", "stl", "usdz", "3mf"]}
          selected={props.outputFormats}
          required="glb"
          onChange={props.onOutputFormatsChange}
        />
      </>
    );
  }

  if (props.adapter === "hunyuan") {
    const isHunyuan31 = isHunyuan31ModelId(props.remoteModelId);
    const type = props.inputMode === "multiview" ? "Normal" : text("generateType", "Normal");
    const customFormat = props.outputFormats.length === 1 &&
      ["fbx", "stl", "usdz"].includes(props.outputFormats[0] ?? "")
      ? props.outputFormats[0]!
      : "standard";
    return (
      <>
        <SelectField label="输出格式" value={customFormat} onChange={(value) => {
          props.onOutputFormatsChange(
            value === "standard"
              ? type === "Geometry" ? ["glb"] : ["glb", "obj"]
              : [value as ModelOutputFormat]
          );
        }}>
          <option value="standard">{type === "Geometry" ? "GLB（可网页查看）" : "GLB + OBJ（可网页查看）"}</option>
          <option value="fbx">FBX</option>
          <option value="stl">STL</option>
          <option value="usdz">USDZ</option>
        </SelectField>
        {props.inputMode === "multiview" ? (
          <label className="field">
            <span>生成模式</span>
            <input value="标准模型" readOnly />
          </label>
        ) : (
          <SelectField label="生成模式" value={type} onChange={(value) => {
            set("generateType", value);
            if (customFormat === "standard") {
              props.onOutputFormatsChange(value === "Geometry" ? ["glb"] : ["glb", "obj"]);
            }
          }}>
            <option value="Normal">标准模型</option>
            {!isHunyuan31 && <option value="LowPoly">智能拓扑</option>}
            <option value="Geometry">白模</option>
            {!isHunyuan31 && <option value="Sketch">草图生成</option>}
          </SelectField>
        )}
        {type !== "Geometry" && (
          <Toggle label="PBR 材质" checked={bool("pbr", false)} onChange={(checked) => set("pbr", checked)} />
        )}
        {type !== "LowPoly" && (
          <NumberField
            label="目标面数（3,000–1,500,000）"
            value={number("targetFaceCount", 500_000)}
            min={3_000}
            max={1_500_000}
            step={1_000}
            onChange={(value) => set("targetFaceCount", value)}
          />
        )}
        {type === "LowPoly" && (
          <SelectField label="多边形类型" value={text("polygonType", "triangle")} onChange={(value) => set("polygonType", value)}>
            <option value="triangle">三角面</option>
            <option value="quadrilateral">四边面与三角面混合</option>
          </SelectField>
        )}
        {!props.outputFormats.includes("glb") && (
          <p className="modeling-config-note">此格式没有 GLB 在线预览，生成后可直接下载。</p>
        )}
      </>
    );
  }

  if (props.adapter === "stability-3d") {
    return (
      <>
        <OutputFormatChecks
          formats={["glb"]}
          selected={["glb"]}
          required="glb"
          onChange={props.onOutputFormatsChange}
        />
        <p className="modeling-config-note">
          Stability AI 3D 使用图片生成模型，当前输出 GLB，可直接在网页中查看。
        </p>
      </>
    );
  }

  if (!props.adapter) return null;

  const p1 = props.remoteModelId.startsWith("P1-");
  const supportsGeometryQuality = props.remoteModelId.startsWith("v3.");
  const texture = bool("texture", true);
  const quad = !p1 && bool("quad", false);
  const smartLowPoly = !p1 && bool("smartLowPoly", false);
  const generateParts = !p1 && bool("generateParts", false);
  const faceCount = typeof props.parameters.targetFaceCount === "number"
    ? props.parameters.targetFaceCount
    : null;
  const faceRange = tripoFaceCountRange(props.remoteModelId, props.parameters);
  return (
    <>
      <OutputFormatChecks
        formats={["glb", "obj", "fbx", "stl", "usdz", "3mf"]}
        selected={props.outputFormats}
        required="glb"
        onChange={props.onOutputFormatsChange}
      />
      {props.inputMode === "text" && (
        <label className="field">
          <span>反向提示词</span>
          <textarea
            rows={3}
            maxLength={255}
            value={text("negativePrompt", "")}
            onChange={(event) => set("negativePrompt", event.target.value)}
          />
          <small>{text("negativePrompt", "").length}/255</small>
        </label>
      )}
      <Toggle label="生成纹理" checked={texture} onChange={(checked) =>
        props.onParametersChange({
          ...props.parameters,
          texture: checked,
          ...(checked ? { generateParts: false } : { pbr: false })
        })
      } />
      <Toggle label="PBR 材质" checked={bool("pbr", true)} disabled={!texture} onChange={(checked) => set("pbr", checked)} />
      {supportsGeometryQuality && (
        <SelectField label="几何质量" value={text("geometryQuality", "standard")} onChange={(value) => set("geometryQuality", value)}>
          <option value="standard">标准</option>
          <option value="detailed">精细</option>
        </SelectField>
      )}
      {texture && (
        <>
          <SelectField label="纹理质量" value={text("textureQuality", "standard")} onChange={(value) => set("textureQuality", value)}>
            <option value="standard">标准</option>
            <option value="detailed">精细</option>
            <option value="extreme">最高</option>
          </SelectField>
          <OptionalNumberField
            label="纹理随机种子"
            value={typeof props.parameters.textureSeed === "number" ? props.parameters.textureSeed : null}
            onChange={(value) => set("textureSeed", value)}
          />
        </>
      )}
      {props.inputMode === "image" && (
        <Toggle
          label="输入图自动修复"
          checked={bool("imageAutofix", false)}
          onChange={(checked) => set("imageAutofix", checked)}
        />
      )}
      {(props.inputMode === "image" || props.inputMode === "multiview") && texture && (
        <>
          <SelectField label="纹理对齐" value={text("textureAlignment", "original_image")} onChange={(value) => set("textureAlignment", value)}>
            <option value="original_image">优先匹配原图</option>
            <option value="geometry">优先匹配几何结构</option>
          </SelectField>
          <Toggle
            label="自动对齐原图方向"
            checked={text("orientation", "default") === "align_image"}
            onChange={(checked) => set("orientation", checked ? "align_image" : "default")}
          />
        </>
      )}
      {!p1 && (
        <>
          <Toggle
            label="智能低面数拓扑"
            checked={smartLowPoly}
            disabled={generateParts}
            onChange={(checked) => props.onParametersChange({
              ...props.parameters,
              smartLowPoly: checked,
              ...(faceCount !== null ? { targetFaceCount: checked ? Math.min(faceCount, 20_000) : faceCount } : {})
            })}
          />
          <Toggle
            label="四边面输出"
            checked={quad}
            disabled={generateParts}
            onChange={(checked) => props.onParametersChange({
              ...props.parameters,
              quad: checked,
              ...(faceCount !== null ? { targetFaceCount: checked ? Math.min(faceCount, smartLowPoly ? 10_000 : 150_000) : faceCount } : {})
            })}
          />
          <Toggle
            label="生成可编辑部件"
            checked={generateParts}
            onChange={(checked) => props.onParametersChange({
              ...props.parameters,
              generateParts: checked,
              ...(checked ? { texture: false, pbr: false, quad: false } : {})
            })}
          />
        </>
      )}
      <Toggle
        label="指定目标面数"
        checked={faceCount !== null}
        onChange={(checked) => set(
          "targetFaceCount",
          checked ? Math.min(10_000, faceRange.maximum) : null
        )}
      />
      {faceCount !== null && (
        <NumberField
          label={`目标面数（${faceRange.minimum.toLocaleString()}–${faceRange.maximum.toLocaleString()}）`}
          value={faceCount}
          min={faceRange.minimum}
          max={faceRange.maximum}
          step={p1 ? 100 : 1_000}
          onChange={(value) => set("targetFaceCount", value)}
        />
      )}
      <OptionalNumberField
        label="模型随机种子"
        value={typeof props.parameters.modelSeed === "number" ? props.parameters.modelSeed : null}
        onChange={(value) => set("modelSeed", value)}
      />
      {props.inputMode === "text" && (
        <OptionalNumberField
          label="文本生成随机种子"
          value={typeof props.parameters.imageSeed === "number" ? props.parameters.imageSeed : null}
          onChange={(value) => set("imageSeed", value)}
        />
      )}
      <Toggle label="自动调整真实尺寸" checked={bool("autoSize", false)} onChange={(checked) => set("autoSize", checked)} />
      <Toggle label="展开 UV" checked={bool("exportUv", true)} onChange={(checked) => set("exportUv", checked)} />
      <SelectField label="模型压缩" value={text("compression", "default")} onChange={(value) => set("compression", value)}>
        <option value="default">默认</option>
        <option value="geometry">几何压缩</option>
      </SelectField>
    </>
  );
}

function OutputFormatChecks(props: {
  formats: ModelOutputFormat[];
  selected: ModelOutputFormat[];
  required?: ModelOutputFormat;
  onChange: (value: ModelOutputFormat[]) => void;
}) {
  return (
    <fieldset className="modeling-format-field">
      <legend>输出格式 <em>*</em></legend>
      <div>
        {props.formats.map((format) => {
          const checked = props.selected.includes(format);
          const required = props.required === format;
          return (
            <label key={format}>
              <input
                type="checkbox"
                checked={checked}
                disabled={required}
                onChange={(event) => props.onChange(
                  event.target.checked
                    ? [...props.selected, format]
                    : props.selected.filter((item) => item !== format)
                )}
              />
              {format.toUpperCase()}
            </label>
          );
        })}
      </div>
      <small>GLB 用于网页预览；其他格式作为原始文件保存。</small>
    </fieldset>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-field">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.children}
      </select>
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function OptionalNumberField(props: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        step={1}
        value={props.value ?? ""}
        placeholder="自动"
        onChange={(event) => props.onChange(
          event.target.value === "" ? null : Number(event.target.value)
        )}
      />
    </label>
  );
}

function meshModelLabel(model: string): string {
  if (model === "latest") return "Latest（Meshy 7）";
  if (model === "meshy-t2") return "Meshy T2";
  if (model === "meshy-t1") return "Meshy T1";
  return model.replace(/^meshy-/u, "Meshy ");
}

function isSmartMeshyModel(model: string): boolean {
  return model === "meshy-t1" || model === "meshy-t2";
}

