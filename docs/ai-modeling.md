# AI 建模

## 边界

- 图片生成模块只产出图片。
- AI 建模模块只接收当前项目内的一张图片，产出模型文件。
- AI 建模使用独立的 `ModelGenerationRequest`，不包含图片提示词、生成张数、对话附件等字段。
- 建模任务复用项目、任务队列、事件和文件存储基础设施，但不复用图片供应商适配器。

## 请求

```json
{
  "imageAssetId": "asset_image",
  "textureImageAssetId": "optional_texture_reference",
  "providerProfileId": "provider_model",
  "providerModelId": "model_model",
  "outputFormats": ["glb", "obj"],
  "parameters": {
    "texture": true,
    "pbr": true,
    "targetFaceCount": 100000
  }
}
```

`parameters` 由所选供应商和模型决定。前端只展示该组合支持的参数，后端适配器再次校验。

## 文件与查看

- 建模任务卡是模型文件的主入口，直接提供 GLB 查看和其他格式下载；查看器下方不再重复展示同一批模型文件。
- 网页查看器只读取 `model/gltf-binary` 类型的 GLB。
- 查看器支持显示设置、拓扑模式、网格、自动旋转、重置视角、全屏、FOV 和贴图开关。
- 拓扑模式使用无贴图实体材质作为底面，再以独立渲染通道覆盖三角面拓扑线；不会修改或复制原模型 Geometry。
- 光照设置使用查看器右上角独立面板。日光模式由程序化天空环境光和以模型中心为目标的平行光组成；摄影棚模式使用室内环境贴图、主光、补光和轮廓光；均匀检查模式不使用方向光和阴影。
- 日光与摄影棚模式可独立调整光照强度、方向、高度和阴影。阴影相机会根据模型边界自动适配，避免固定范围导致阴影缺失。
- 曝光属于色调映射的画面后处理参数，放在显示设置内，不作为光源强度使用。
- 查看器设置保存在浏览器本地。切换光照模式、页面或重新打开应用时，会恢复各模式独立的参数。
- 模型加载后可显示拓扑、顶点和面数统计。
- 导出格式作为独立项目资产保存，不做隐式本地格式转换。
- 供应商返回 ZIP 包时保留 ZIP，不伪装成 OBJ 或 FBX。
- Meshy API 会分别返回 OBJ 模型地址和 `texture_urls`。当 OBJ 是裸文件且存在纹理地址时，Worker 会将 OBJ 与纹理文件打包为 `OBJ 压缩包`；若供应商本身返回 ZIP，则直接保留原包。没有纹理地址时仍保存裸 OBJ。供应商没有返回 MTL 映射时，压缩包会保留全部纹理文件，外部建模软件可能仍需重新关联材质。
- 所有带时效的供应商下载链接会在任务完成后立即下载到项目目录。
- 一个任务的多个文件通过 `job_outputs` 保留同一来源关系。

## 3D 查看器架构

查看器按三层拆分，建模页面不直接操作 Three.js 的内部 API：

```text
ModelingPage
  └─ ModelViewer（界面和用户操作）
      └─ ModelViewerAdapter（渲染器适配层）
          └─ ThreeViewerAdapter（Three.js / GLB 渲染）
      └─ model-viewer-stats（纯数据统计）
```

- `ModelViewer.tsx` 只负责标题、控制栏、滑块、空状态和统计展示。
- `three-viewer-adapter.ts` 负责 GLB 加载、WebGL 生命周期、相机、实体与拓扑双通道渲染、环境光照、方向光、色调映射、阴影和材质贴图控制。
- 查看器统一管理 `idle/loading/ready/error` 生命周期，页面不会因为模型尚未加载而显示空白区域。
- `model-viewer-stats.ts` 只读取场景数据并计算网格、顶点、面数和动画数量，不依赖 React。
- 后续增加剖切、骨骼、多个模型叠加或 PBR 通道时，只扩展适配器，不修改建模任务和资产接口。

## Meshy

- 接口：`POST /openapi/v1/image-to-3d`、`GET /openapi/v1/image-to-3d/:id`。
- 模型：`latest`、`meshy-6`、`meshy-5`、`meshy-t2`、`meshy-t1`。
- 输出：`glb`、`obj`、`fbx`、`stl`、`usdz`、`3mf`，通过 `target_formats` 多选。
- `image_url` 是模型几何输入图；可选的 `texture_image_url` 是独立纹理输入图，两张图可以不同。
- 项目使用可选的 `textureImageAssetId` 保存纹理输入图来源，并在提交时转换为 `texture_image_url`。
- `texture_image_url` 和 `texture_prompt` 不能同时生效；选择纹理参考图时以图片为准。
- 为保证网页查看，应用会在 Meshy 请求中保留 GLB，并同时请求用户选择的导出格式。
- 标准模型目标面数为 100 至 300,000；Meshy T2 为 100 至 15,000；T1 不支持目标面数。
- Meshy 5 只使用 2K 纹理；Meshy 6/Latest 支持 2K、4K、8K。

官方文档：[Meshy Image to 3D](https://docs.meshy.ai/en/api/image-to-3d)。

## 腾讯混元

- 接口：`POST /v1/ai3d/submit`、`POST /v1/ai3d/query`。
- 认证：单 API Key，直接写入 `Authorization`。
- 模型：3.0、3.1。
- 标准模式默认返回 GLB 和 OBJ；Geometry 默认返回 GLB。
- `ResultFormat` 每次只能指定一种：FBX、STL 或 USDZ。选择这些格式时不保证存在 GLB 网页预览。
- 目标面数为 3,000 至 1,500,000；LowPoly 不使用目标面数。
- 3.1 不提供 LowPoly 和 Sketch。

官方文档：

- [OpenAI 兼容接口](https://cloud.tencent.com/document/product/1804/126189)
- [提交专业版任务](https://cloud.tencent.com/document/product/1804/123447)
- [查询专业版任务](https://cloud.tencent.com/document/product/1804/123448)

## Tripo

- 接口：`POST /upload/sts`、`POST /task`、`GET /task/:id`。
- 模型：P1、Turbo、v3.1、v3.0、v2.5。
- 初始图片建模任务先生成 GLB；如果选择 OBJ、FBX、STL、USDZ 或 3MF，Worker 会继续创建 Tripo `convert_model` 任务并下载转换结果。
- 输出格式可选 `glb`、`obj`、`fbx`、`stl`、`usdz`、`3mf`；GLB 用于网页查看，格式转换可能产生额外费用。
- 不启用 `quad=true`，因为该参数会把输出切换为 FBX，无法同时满足当前 GLB 查看流程。
- P1 目标面数上限为 20,000；v2.5 上限为 500,000；v3 系列按质量档支持更高面数。

官方文档：

- [Tripo Generation](https://platform.tripo3d.ai/docs/generation)
- [Tripo Post Process](https://platform.tripo3d.ai/docs/post-process)
- [Tripo Task](https://platform.tripo3d.ai/docs/task)
- [Tripo Upload](https://platform.tripo3d.ai/docs/upload)

## 取消与重试

- 前端“停止”表示停止本地等待并终止 Worker 的当前请求。
- 三家供应商没有统一的远程取消能力，因此界面不宣称已取消远端计费任务。
- 已有远端任务 ID 的中断任务会恢复查询，不重复提交付费任务。
- 远端已完成但本地保存失败时，重试优先复用原任务并重新下载。
