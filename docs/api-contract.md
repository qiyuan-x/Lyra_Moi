# Lyra API 契约

## 1. 约定

- 基础路径：`/api/v1`
- JSON 请求与响应；素材上传使用 `multipart/form-data`
- 时间使用 UTC ISO 8601，业务 ID 使用 UUID
- Agent、图片生成和 AI 建模返回 `202 Accepted`
- 状态通过 REST 查询和 SSE 更新
- 桌面模式同源访问；服务器模式使用 Bearer Token 或认证反向代理

服务器模式除健康检查和前端静态文件外，所有 `/api/v1` 请求必须携带：

```http
Authorization: Bearer <LYRA_ACCESS_TOKEN>
```

浏览器中的素材地址和 SSE 连接使用同一个令牌。未认证请求返回 `401 UNAUTHORIZED`。

错误格式：

```json
{
  "error": {
    "code": "ASSET_NOT_FOUND",
    "message": "素材不存在。",
    "details": null
  },
  "requestId": "req_..."
}
```

## 2. 健康检查

### `GET /api/v1/health/live`

检查 API 进程存活。

### `GET /api/v1/health/ready`

检查数据库迁移、Web 静态文件和 Worker 心跳。启动器只有在该接口返回 `ok: true` 后才打开浏览器。

```json
{
  "ok": true,
  "database": "ready",
  "web": "ready",
  "worker": "ready"
}
```

## 3. 项目

### `GET /api/v1/projects`

列出项目。

### `POST /api/v1/projects`

```json
{
  "name": "角色设计",
  "description": ""
}
```

### `PATCH /api/v1/projects/:projectId`

允许更新名称、说明和 `lastImageMode: "agent" | "manual"`。

### `DELETE /api/v1/projects/:projectId`

软删除。没有替代项目时不能删除默认项目。

## 4. 素材

### `POST /api/v1/projects/:projectId/assets`

上传素材：

```text
file=<binary>
name=<optional>
tags=<optional>
```

后端按文件内容验证格式、MIME、扩展名、尺寸和大小，并保存不可变内容寻址 Blob。第一阶段接受 JPEG、PNG、WebP、GIF 和 AVIF；默认最大 25 MiB、6400 万像素、单边 16384 像素。

### `GET /api/v1/projects/:projectId/assets`

查询参数：`cursor`、`limit`、`search`、`tag`、`source`、`kind`。

### `GET /api/v1/assets/:assetId`

返回元数据，不返回绝对路径。

### `GET /api/v1/assets/:assetId/content`

返回受控原始内容，支持 ETag。

### `GET /api/v1/assets/:assetId/thumbnail`

返回缩略图。

### `PATCH /api/v1/assets/:assetId`

```json
{
  "name": "角色参考图",
  "tags": ["角色", "参考"]
}
```

### `DELETE /api/v1/assets/:assetId`

软删除，不破坏历史任务和 Agent 步骤。

### 模型素材

AI 建模输出以 `kind=model`、`mimeType=model/gltf-binary` 保存。模型没有图片缩略图；通过内容接口读取 GLB：

```http
GET /api/v1/projects/:projectId/assets?kind=model
GET /api/v1/assets/:assetId/content
```

## 5. AI 建模

### `POST /api/v1/projects/:projectId/model-generations`

```json
{
  "imageAssetId": "asset_image",
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

规则：

- 输入素材必须是当前项目内的图片。
- 供应商和模型必须属于 `model` 服务并已启用。
- `pbr=true` 时必须同时设置 `texture=true`。
- `targetFaceCount` 可为 `null`，或为 3000 至 1500000 的整数。
- 响应中的任务 `kind` 为 `model.generate`，并包含 `progress` 和 `externalTaskId`。

## 6. Agent 对话

### `GET /api/v1/projects/:projectId/conversations`

分页列出 Agent 对话。

### `POST /api/v1/projects/:projectId/conversations`

创建对话，标题可省略。

### `PATCH /api/v1/conversations/:conversationId`

更新标题。

### `DELETE /api/v1/conversations/:conversationId`

软删除对话。

### `GET /api/v1/conversations/:conversationId/messages`

读取消息、附件、Agent Run 和关联图片任务摘要。

### `POST /api/v1/conversations/:conversationId/messages`

Agent 模式的主要入口。保存用户消息和有序附件，然后创建持久化 Agent Run。

```json
{
  "text": "用图一的人物替换图二的人物，保持图二的动作和背景。",
  "attachments": [
    {
      "assetId": "asset_001",
      "position": 1,
      "label": "图1"
    },
    {
      "assetId": "asset_002",
      "position": 2,
      "label": "图2"
    }
  ],
  "selection": {
    "llmProviderProfileId": "provider_llm",
    "llmModelId": "model_llm",
    "defaultImageProviderProfileId": "provider_image",
    "defaultImageModelId": "model_image"
  }
}
```

规则：

- 附件是本轮唯一的图片输入来源。
- `position` 从 1 连续递增。
- Agent 可以解释附件用途，但不能静默重排或遗漏。
- 模型选择可省略，省略时使用设置中的默认模型。
- 原始 `text` 必须原样保存。

响应：

```json
{
  "message": {
    "id": "message_...",
    "role": "user",
    "text": "用图一的人物替换图二的人物，保持图二的动作和背景。"
  },
  "agentRun": {
    "id": "agent_run_...",
    "status": "queued"
  }
}
```

状态：`202 Accepted`。

## 7. Agent Run

### `GET /api/v1/agent-runs/:agentRunId`

返回：

- 当前状态
- LLM 供应商和模型
- 已执行工具次数
- 当前步骤
- 工具调用摘要
- 等待的图片任务
- 最终回复或错误

### `POST /api/v1/agent-runs/:agentRunId/cancel`

请求取消 Agent。若 Agent 正在等待图片任务，可选择同时请求取消子任务。

```json
{
  "cancelChildJobs": true
}
```

状态：`202 Accepted`。

### `POST /api/v1/agent-runs/:agentRunId/input`

当状态为 `awaiting_user` 时提交补充信息。

```json
{
  "text": "保留图二背景。",
  "choiceId": "keep-background",
  "attachments": []
}
```

提交后 Agent 进入 `resuming`。其他状态调用返回 `409`。

### `GET /api/v1/agent-runs/:agentRunId/steps`

返回可公开的执行轨迹，用于 Agent 模式展示工具调用和排查问题。不返回系统密钥和完整内部思维内容。

## 8. 手动图片生成

### `POST /api/v1/projects/:projectId/generations`

手动模式直接调用统一 `GenerationService`，不创建 Agent Run。

```json
{
  "prompt": "用图一的人物替换图二的人物，保持图二的动作和背景。",
  "attachments": [
    {
      "assetId": "asset_001",
      "position": 1,
      "label": "图1"
    },
    {
      "assetId": "asset_002",
      "position": 2,
      "label": "图2"
    }
  ],
  "providerProfileId": "provider_image",
  "providerModelId": "model_image",
  "count": 1,
  "parameters": {
    "aspectRatio": "1:1"
  }
}
```

响应：

```json
{
  "job": {
    "id": "job_image_...",
    "source": "manual",
    "kind": "image.generate",
    "status": "queued"
  }
}
```

状态：`202 Accepted`。

## 9. Agent 图片工具

`generate_image` 是内部工具，不单独暴露不受验证的公网接口。它通过同一个 `GenerationService` 创建 `source: "agent"` 的图片任务。

工具逻辑：

1. 使用当前 Agent Run 的显式附件和原始顺序。
2. 使用工具提示词和默认或明确指定的图片模型。
3. 保存 `agent_steps.tool_call`。
4. 创建图片 Job 并关联 Agent Run/Step。
5. 将 Agent Run 置为 `waiting_tool`。
6. 图片完成后保存 `tool_result` 并恢复 Agent。

## 10. 图片任务

### `GET /api/v1/jobs`

查询参数：`projectId`、`conversationId`、`agentRunId`、`source`、`status`、`kind`、`cursor`、`limit`。

### `GET /api/v1/jobs/:jobId`

返回任务状态、阶段、供应商、模型、提示词、输入素材、输出素材、错误和时间。

### `POST /api/v1/jobs/:jobId/cancel`

请求取消图片任务。终态任务返回 `409`。

### `POST /api/v1/jobs/:jobId/retry`

使用已清理请求快照创建新任务。手动任务直接返回新任务；Agent 子任务重试时必须与 Agent Run 恢复规则一致，不能重复插入工具步骤。

新任务使用新的任务 ID、递增 `attempt`，并返回 `retryOfJobId` 指向来源任务。旧任务状态和结果不修改。

```json
{
  "providerProfileId": "provider_other",
  "providerModelId": "model_other"
}
```

## 11. SSE 事件

### `GET /api/v1/events`

查询参数：

```text
projectId=<required>
conversationId=<optional>
```

使用 `Last-Event-ID` 或 `afterEventId` 断线续传。

```text
id: 1042
event: agent.waiting_tool
data: {"agentRunId":"agent_run_...","jobId":"job_..."}
```

事件包：

```ts
interface ServerEvent<T = unknown> {
  id: number;
  type: string;
  projectId: string;
  conversationId?: string;
  agentRunId?: string;
  jobId?: string;
  data: T;
  createdAt: string;
}
```

主要事件：

```text
message.created
message.delta
message.completed
agent.run.created
agent.thinking
agent.tool.called
agent.waiting_tool
agent.awaiting_user
agent.completed
agent.failed
job.created
job.updated
job.completed
job.failed
asset.created
```

SSE 只负责通知，REST 和数据库状态是最终事实。

## 12. 供应商和模型

### `GET /api/v1/providers`

返回连接和模型，不返回密钥原值。连接只包含 `hasApiKey` 和固定掩码 `apiKeyMask`。

### `POST /api/v1/providers`

```json
{
  "serviceType": "image",
  "name": "供应商 A",
  "protocol": "openai-compatible",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "secret",
  "enabled": true
}
```

`serviceType` 创建后不可修改。LLM、AI 生图和 AI 建模必须分别创建连接。

### `PATCH /api/v1/providers/:providerId`

省略 `apiKey` 表示保留，`clearApiKey: true` 表示删除。

### `DELETE /api/v1/providers/:providerId`

软删除。存在运行中 Agent 或任务时返回 `409`。

### `POST /api/v1/providers/:providerId/test`

测试连接，不回显密钥。成功后按连接的 `serviceType` 过滤并同步远端模型。

### `POST /api/v1/providers/:providerId/discover`

支持时读取远端模型 ID 和显示名称，并按连接能力过滤；该接口只发现，不保存。设置页通常调用连接测试接口完成发现和同步。

### `POST /api/v1/providers/:providerId/models`

```json
{
  "serviceType": "llm",
  "remoteModelId": "actual-model-id",
  "displayName": "Agent 模型",
  "enabled": true,
  "isDefault": true,
  "settings": {}
}
```

### `PATCH /api/v1/provider-models/:modelId`

更新显示名称、启用状态、默认状态和非密钥参数。

### `DELETE /api/v1/provider-models/:modelId`

软删除模型。

## 13. 提示词库

提示词库是应用级全局数据，不依赖当前项目。所有模板使用相同的编辑、收藏、导入和导出规则。

### `GET /api/v1/prompts`

返回全局提示词模板。支持 `search`、`category` 和 `favorite` 查询。

### `POST /api/v1/prompts`

创建全局模板。`category` 用于筛选和分组，`note` 用于记录适用模型或其他说明。

### `PATCH /api/v1/prompts/:promptId`

修改模板内容、分类、备注或收藏状态。

### `DELETE /api/v1/prompts/:promptId`

软删除模板。

## 14. 应用设置

### `GET /api/v1/settings/agent-prompts`

返回当前 Agent 主系统提示词、允许优化提示词规则、禁止优化提示词规则及其默认值。该接口受应用访问令牌保护。

### `PATCH /api/v1/settings/agent-prompts`

部分或完整更新 Agent 提示词配置。提示词不能为空，单项最多 30,000 个字符。

### `DELETE /api/v1/settings/agent-prompts`

删除自定义覆盖并恢复资源文件和程序内置的默认提示词。

### `GET /api/v1/settings`

返回默认项目、默认 LLM、默认图片模型、Agent 最大工具调用次数、Worker 并发数和服务器设置。

### `PATCH /api/v1/settings`

使用 `expectedRevision` 做乐观并发控制。API Key 不通过该接口读取。

## 15. 限制和安全

- JSON 请求默认限制 2 MB。
- 图片上传默认限制 25 MiB，可配置。
- 不接受前端提供的本地绝对路径。
- 供应商请求快照、Agent 步骤和事件保存前必须移除密钥与 Authorization。
- 供应商结果下载限制超时、响应大小和内容类型。
- Agent 系统提示词只通过受访问令牌保护的设置接口返回，不进入普通工作区查询和 Agent 运行记录。
- 浏览器断开不能触发 Agent 或图片任务取消。
