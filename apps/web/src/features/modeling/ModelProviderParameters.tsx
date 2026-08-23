import type { ReactNode } from "react";
import {
  isMeshyGenerationModel,
  type ModelOutputFormat,
  type ProviderAdapterType
} from "@lyra/contracts";

export function ModelProviderParameters(props: {
  adapter: ProviderAdapterType;
  remoteModelId: string;
  parameters: Record<string, unknown>;
  outputFormats: ModelOutputFormat[];
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

  if (isMeshyGenerationModel(props.adapter, props.remoteModelId)) {
    const smart = props.remoteModelId === "meshy-t1" || props.remoteModelId === "meshy-t2";
    const texture = bool("texture", true);
    const targetMaximum = smart ? 15_000 : 300_000;
    const targetFaceCount = typeof props.parameters.targetFaceCount === "number"
      ? props.parameters.targetFaceCount
      : null;
    return (
      <>
        {props.adapter === "openai-compatible" && (
          <p className="modeling-config-note">
            当前模型通过 OpenAI 兼容 3D 端点提交，生成参数复用 Meshy 设置。
          </p>
        )}
        <OutputFormatChecks
          formats={["glb", "obj", "fbx", "stl", "usdz", "3mf"]}
          selected={props.outputFormats}
          required="glb"
          onChange={props.onOutputFormatsChange}
        />
        <Toggle label="生成纹理" checked={texture} onChange={(checked) =>
          props.onParametersChange({
            ...props.parameters,
            texture: checked,
            ...(!checked ? { pbr: false } : {})
          })
        } />
        <Toggle label="PBR 材质" checked={bool("pbr", true)} disabled={!texture} onChange={(checked) => set("pbr", checked)} />
        {texture && (
          <>
            <p className="modeling-config-note">
              可在上方“纹理输入图”输入槽选择另一张图片；与模型结构差异过大会影响贴图效果。
            </p>
            <SelectField label="纹理分辨率" value={text("textureResolution", "2k")} onChange={(value) => set("textureResolution", value)}>
              <option value="2k">2K</option>
              {!props.remoteModelId.includes("meshy-5") && <option value="4k">4K</option>}
              {!props.remoteModelId.includes("meshy-5") && <option value="8k">8K</option>}
            </SelectField>
          </>
        )}
        {!smart && (
          <SelectField label="拓扑" value={text("topology", "triangle")} onChange={(value) => set("topology", value)}>
            <option value="triangle">三角面</option>
            <option value="quad">四边面为主</option>
          </SelectField>
        )}
        {props.remoteModelId !== "meshy-t1" && (
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
        {["latest", "meshy-6", "meshy-7"].includes(props.remoteModelId) && (
          <>
            <Toggle label="输入图增强" checked={bool("imageEnhancement", true)} onChange={(checked) => set("imageEnhancement", checked)} />
            {props.remoteModelId === "meshy-6" && (
              <Toggle label="移除纹理光照" checked={bool("removeLighting", true)} onChange={(checked) => set("removeLighting", checked)} />
            )}
            {["latest", "meshy-7"].includes(props.remoteModelId) && (
              <Toggle label="Ultra 模式" checked={bool("ultraMode", false)} onChange={(checked) => set("ultraMode", checked)} />
            )}
          </>
        )}
      </>
    );
  }

  if (props.adapter === "hunyuan") {
    const type = text("generateType", "Normal");
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
        <SelectField label="生成模式" value={type} onChange={(value) => {
          set("generateType", value);
          if (customFormat === "standard") {
            props.onOutputFormatsChange(value === "Geometry" ? ["glb"] : ["glb", "obj"]);
          }
        }}>
          <option value="Normal">标准模型</option>
          {props.remoteModelId !== "3.1" && <option value="LowPoly">智能拓扑</option>}
          <option value="Geometry">白模</option>
          {props.remoteModelId !== "3.1" && <option value="Sketch">草图生成</option>}
        </SelectField>
        {type !== "Geometry" && (
          <Toggle label="PBR 材质" checked={bool("pbr", true)} onChange={(checked) => set("pbr", checked)} />
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

  if (props.adapter === "openai-compatible") {
    return (
      <>
        <OutputFormatChecks
          formats={["glb"]}
          selected={["glb"]}
          required="glb"
          onChange={props.onOutputFormatsChange}
        />
        <p className="modeling-config-note">
          OpenAI 兼容 3D API 使用统一端点处理文字或图片建模，输出 GLB，可直接在网页中查看。
        </p>
      </>
    );
  }

  const p1 = props.remoteModelId.startsWith("P1-");
  const supportsGeometryQuality = props.remoteModelId.startsWith("v3.");
  const texture = bool("texture", true);
  return (
    <>
      <OutputFormatChecks
        formats={["glb", "obj", "fbx", "stl", "usdz", "3mf"]}
        selected={props.outputFormats}
        required="glb"
        onChange={props.onOutputFormatsChange}
      />
      <p className="modeling-config-note">OBJ、FBX 等格式会调用 Tripo 转换任务，可能产生额外费用。</p>
      <Toggle label="生成纹理" checked={texture} onChange={(checked) =>
        props.onParametersChange({
          ...props.parameters,
          texture: checked,
          ...(!checked ? { pbr: false } : {})
        })
      } />
      <Toggle label="PBR 材质" checked={bool("pbr", true)} disabled={!texture} onChange={(checked) => set("pbr", checked)} />
      {supportsGeometryQuality && (
        <SelectField label="几何质量" value={text("geometryQuality", "standard")} onChange={(value) => set("geometryQuality", value)}>
          <option value="standard">标准</option>
          <option value="detailed">精细</option>
        </SelectField>
      )}
      <SelectField label="纹理质量" value={text("textureQuality", "standard")} onChange={(value) => set("textureQuality", value)}>
        <option value="standard">标准</option>
        <option value="detailed">精细</option>
        <option value="extreme">最高</option>
      </SelectField>
      <Toggle
        label="输入图自动修复"
        checked={bool("imageAutofix", false)}
        onChange={(checked) => set("imageAutofix", checked)}
      />
      <Toggle
        label="自动对齐原图方向"
        checked={text("orientation", "default") === "align_image"}
        disabled={!texture}
        onChange={(checked) => set("orientation", checked ? "align_image" : "default")}
      />
      {!p1 && !supportsGeometryQuality && (
        <>
          <p className="modeling-config-note">当前模型不提供几何质量档位。</p>
        </>
      )}
      <NumberField
        label="目标面数"
        value={number("targetFaceCount", p1 ? 20_000 : 500_000)}
        min={p1 ? 48 : 1_000}
        max={p1
          ? 20_000
          : supportsGeometryQuality
            ? text("geometryQuality", "standard") === "detailed" ? 2_000_000 : 1_500_000
            : 500_000}
        step={1_000}
        onChange={(value) => set("targetFaceCount", value)}
      />
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

