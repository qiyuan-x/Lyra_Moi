# Lyra 设计文档

本目录记录重构后的正式设计。现有 Lyra 实现只作为调研参考；AnythingLLM 的 AIbitat Agent 核心作为二次开发来源。

## 文档索引

- [系统架构](./architecture.md)
- [数据模型](./data-model.md)
- [API 契约](./api-contract.md)
- [开发计划](./development-plan.md)
- [图片生成工作区](./image-generation-workflow.md)

## 当前范围

- Agent 和手动两种图片生成模式
- 基于 AnythingLLM AIbitat 改造的持久化 Agent Engine
- 用户显式添加素材后，通过对话或手动参数生成图片
- OpenAI、Gemini、OpenAI Compatible 三类供应商
- 素材库、提示词库、设置和图片生成工作区
- SQLite 持久化任务与独立 Worker
- Windows 图形启动器和服务器部署
- AI 建模支持单图输入、独立后台任务、项目级多格式存储和 GLB 浏览器查看
- Agent 可在图片结果后发起建模，但提交前必须经过用户审核
- [AI 建模设计与供应商能力](./ai-modeling.md)

## 明确不做

- 不自动判断“当前查看图片”应当作为哪次生成的输入
- 不把三视图、发型、服装、部件等定义为固定业务操作
- 不在第一阶段实现遮罩、局部重绘和多模态 LLM 图片分析
- Agent 建模只负责把已有图片提交到模型供应商；不自动推断素材、不包含多图片合成和模型后处理
- 不迁移现有 Lyra 业务数据和业务实现
- 不把完整 AnythingLLM 作为独立运行服务，不复用其 Workspace、RAG 前端和数据库
