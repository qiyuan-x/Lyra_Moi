import type { AssetSnapshot } from "@lyra/contracts";

const labels: Record<string, string> = {
  texture: "生成纹理", pbr: "生成 PBR 贴图", textureResolution: "纹理分辨率", textureGuideMode: "纹理引导",
  texturePrompt: "纹理提示词", topology: "拓扑类型", targetFaceCount: "目标面数", remesh: "重建网格",
  savePreRemeshedModel: "保存重建前模型", poseMode: "姿态", imageEnhancement: "输入图增强",
  removeLighting: "移除光照", ultraMode: "Ultra 模式", moderation: "内容审核",
  multiViewThumbnails: "多视图缩略图", alphaThumbnail: "透明缩略图", autoSize: "自动尺寸", originAt: "原点位置",
  decimationMode: "减面模式", generateType: "生成类型", polygonType: "多边形类型",
  geometryQuality: "几何精度", textureQuality: "纹理质量", imageAutofix: "输入图自动修复",
  textureAlignment: "纹理对齐", orientation: "朝向", negativePrompt: "排除内容",
  imageSeed: "图片随机种子", modelSeed: "模型随机种子", textureSeed: "纹理随机种子",
  quad: "四边形网格", smartLowPoly: "智能低面数", generateParts: "生成分件", exportUv: "导出 UV", compression: "压缩方式"
};
const views: Record<string, string> = { front: "正面", left: "左侧", right: "右侧", back: "背面", top: "顶部", bottom: "底部", leftFront: "左前", rightFront: "右前" };
const values: Record<string, string> = { image: "图片引导", text: "文字引导", none: "无", triangle: "三角面", quad: "四边形", bottom: "底部", center: "中心", standard: "标准", high: "高", low: "低", default: "默认", original_image: "原图", Normal: "标准", Geometry: "仅几何", LowPoly: "低面数", detailed: "精细" };
function display(value: unknown): string {
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (value === null || value === "" || value === undefined) return "默认";
  if (typeof value === "number") return value.toLocaleString("zh-CN");
  return values[String(value)] ?? String(value);
}
export function ModelApprovalDetails(props: {
  args: Record<string, unknown>;
  summaryOnly?: boolean;
  assets: Map<string, AssetSnapshot>;
  thumbnailUrl: (id: string) => string;
  onPreview: (id: string) => void;
  models: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; name: string }>;
}) {
  const a = props.args;
  const images: Array<[string, unknown]> = [["模型输入图", a.imageAssetId], ["纹理输入图", a.textureImageAssetId]];
  if (a.multiViewImageAssetIds && typeof a.multiViewImageAssetIds === "object") {
    images.push(...Object.entries(a.multiViewImageAssetIds).map(([key, id]): [string, unknown] => [`${views[key] ?? key}参考图`, id]));
  }
  const params = a.parameters && typeof a.parameters === "object" ? Object.entries(a.parameters) : [];
  const primary = new Set(["texture", "textureResolution", "textureGuideMode", "pbr", "topology", "targetFaceCount", "geometryQuality", "textureQuality", "generateType"]);
  const row = ([key, value]: [string, unknown]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{display(value)}</dd></div>;
  return <div className="model-approval-details">
    <dl className="model-approval-summary">
      <div><dt>供应商</dt><dd>{props.providers.find((p) => p.id === a.providerProfileId)?.name ?? "当前选定供应商"}</dd></div>
      <div><dt>模型</dt><dd>{props.models.find((m) => m.id === a.providerModelId)?.name ?? "当前选定模型"}</dd></div>
      <div><dt>生成方式</dt><dd>{a.inputMode === "text" ? "文字生成模型" : a.inputMode === "multiview" ? "多参考图生成" : "单参考图生成"}</dd></div>
      <div><dt>输出格式</dt><dd><strong>{Array.isArray(a.outputFormats) ? a.outputFormats.map((f) => String(f).toUpperCase()).join("、") : "GLB"}</strong></dd></div>
    </dl>
    {a.inputMode === "text" && typeof a.prompt === "string" && <p>{a.prompt}</p>}
    <div className="model-approval-images">{images.flatMap(([label, id]) => typeof id === "string" ? [
      <button key={`${label}-${id}`} type="button" onClick={() => props.onPreview(id)}>
        <img src={props.thumbnailUrl(id)} alt={label} /><span>{label}<small>{props.assets.get(id)?.name ?? id}</small></span>
      </button>
    ] : [])}</div>
    {!props.summaryOnly && <>
    <dl>{params.filter(([key]) => primary.has(key)).map(row)}</dl>
    <details><summary>更多建模设置</summary><dl>{params.filter(([key]) => !primary.has(key) && key in labels).map(row)}</dl></details>
    {params.some(([key]) => !(key in labels)) && <details><summary>供应商扩展参数</summary><dl>{params.filter(([key]) => !(key in labels)).map(row)}</dl></details>}
    </>}
    <p className="model-approval-note">只生成上面列出的格式。</p>
  </div>;
}
