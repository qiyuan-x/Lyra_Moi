# 供应商适配器

本文记录供应商接口边界。核对日期：2026-07-23。

## 1. 路由

| 适配器 | LLM | 图片 | 3D 模型 |
|---|---|---|---|
| OpenAI | `POST /responses` | `POST /images/generations`、`POST /images/edits` | - |
| Gemini | `POST /interactions` | `POST /interactions` | - |
| OpenAI Compatible | `POST /chat/completions` | `POST /images/generations`、`POST /images/edits`；Images 路由不存在时统一回退到 `POST /chat/completions` | - |
| Meshy | - | - | `POST/GET /openapi/v1/image-to-3d` |
| 腾讯混元 | - | - | `SubmitHunyuanTo3DProJob`、`QueryHunyuanTo3DProJob` |
| Tripo | - | - | `POST /upload/sts`、`POST/GET /task` |

连接保存 Base URL 和 API Key 环境变量名；模型记录保存远端模型 ID、服务类型和非密钥设置。Worker 根据任务快照动态创建适配器，不使用全局单例模型。

连接测试读取模型列表并自动同步当前能力的模型。生图任务统一使用当前供应商的 OpenAI 兼容生图协议。

Gemini 官方图片模型对应关系：

- Nano Banana 2：`gemini-3.1-flash-image`
- Nano Banana Pro：`gemini-3-pro-image`
- Nano Banana 2 Lite：`gemini-3.1-flash-lite-image`
- 旧版 Nano Banana：`gemini-2.5-flash-image`

## 2. LLM

- LLM 输入只包含系统提示词、对话文本和有序素材元数据，不读取素材二进制。
- OpenAI Responses 请求设置 `store=false`，工具采用函数定义并关闭并行工具调用。
- OpenAI Compatible 使用常见 Chat Completions 工具格式，API Key 可空。
- Gemini 使用 Interactions API。工具调用返回的 Interaction ID 写入 Agent 检查点，工具完成后通过 `previous_interaction_id` 继续。
- Gemini 每轮重新发送工具定义和系统提示词。

模型设置支持：

```text
temperature
maxOutputTokens
reasoningEffort   # OpenAI
thinkingLevel     # Gemini
```

## 3. 图片

- 没有参考素材时调用文本生图接口。
- 有参考素材时，严格按照 `position` 顺序读取素材并发送。
- OpenAI Images 使用有序的 multipart `image[]` 字段。
- Gemini Interactions 使用一个文本输入，后面按顺序追加图片输入。
- Gemini 的 `count` 通过多次独立请求实现，输出顺序与请求顺序一致。
- OpenAI/Compatible 同时支持 Base64、Data URL 和远端 URL 输出；远端 URL 由后端下载后进入素材存储。
- OpenAI Compatible 遇到 Images 路由 `404` 时，统一改用 Chat Completions 多模态格式；只在明确的路由不存在错误时回退，避免对已受理请求重复计费。
- 供应商返回的二进制仍由统一图片处理器验证真实格式、尺寸和 MIME。

OpenAI 图片参数支持：

```text
size
quality
background
moderation
outputFormat / output_format
outputCompression / output_compression
inputFidelity / input_fidelity
```

Gemini 图片参数支持：

```text
mimeType / mime_type
aspectRatio / aspect_ratio
imageSize / image_size
thinkingLevel / thinking_level
```

## 4. AI 建模

- 输入固定为当前项目内的一张图片，输出固定为 GLB。
- 图片进入供应商前统一转为 JPEG，并限制为 5 MiB、单边 4096 像素。
- Meshy 和 Tripo 使用 Bearer API Key；混元使用腾讯云 `SecretId`、`SecretKey`、Region 和 TC3-HMAC-SHA256 签名。
- 供应商任务 ID、进度和必要的远端状态写入 SQLite。Worker 重启后查询原任务，不重复提交。
- 供应商完成后，Worker 下载 GLB、验证文件头和长度，再写入项目 `generated/models/`。
- 远端任务已成功但本地下载或写入失败时，重试复用原远端任务，避免再次创建收费任务。
- 任务取消、失败、重试和清理复用通用任务接口。

通用参数：

```text
texture
pbr
targetFaceCount
```

## 5. 错误

统一 Provider 错误码：

```text
MISSING_API_KEY
INVALID_CONFIGURATION
AUTHENTICATION_FAILED
PERMISSION_DENIED
RATE_LIMITED
BAD_REQUEST
NOT_FOUND
SERVER_ERROR
HTTP_ERROR
INVALID_RESPONSE
RESPONSE_TOO_LARGE
TIMEOUT
UNREACHABLE
```

图片和建模任务保存为 `PROVIDER_<错误码>`；LLM Agent 失败保存为 `AGENT_PROVIDER_<错误码>`。错误消息不包含 API Key；HTTP 错误只保留经过长度限制的供应商 `message` 字段，便于判断账号、额度和模型通道状态。

## 6. 测试

默认 `pnpm check` 只使用模拟 HTTP，不调用收费 API。真实测试必须在 `.env` 配置相应的 `LYRA_LIVE_*` 变量，并显式设置：

```text
LYRA_RUN_LIVE_PROVIDER_TESTS=1
```

然后执行：

```bash
pnpm test:live
```

## 7. 官方接口依据

- [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Gemini Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini Image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Meshy Image to 3D](https://docs.meshy.ai/en/api/image-to-3d)
- [腾讯混元提交专业版任务](https://cloud.tencent.com/document/product/1804/123447)
- [腾讯混元查询专业版任务](https://cloud.tencent.com/document/product/1804/123448)
- [Tripo Image to Model](https://platform.tripo3d.ai/docs/generation)
- [Tripo Task](https://platform.tripo3d.ai/docs/task)
