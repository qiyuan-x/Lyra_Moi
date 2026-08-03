# 重构审计

## 当前已处理

- 3D 查看器已从 `ModelingPage.tsx` 拆出，页面只负责选择资产和任务。
- 渲染器 API、模型统计和界面控制已分层。
- 建模任务卡是模型文件的唯一操作入口，避免重复资产列表。
- SSE 是前端状态主通道，轮询仅作为连接失败时的兜底。

## 优先级一：建议下一轮处理

### 1. `apps/web/src/app/App.tsx`

当前同时处理初始化、项目切换、对话、任务、资产、设置和通知，接近 1000 行。建议拆成：

- `useWorkspaceState`：项目、对话、资产、任务状态。
- `useWorkspaceActions`：上传、删除、创建任务、重试。
- `useConversationActions`：对话和 Agent 操作。
- `AppShell`：只保留路由和页面组合。

目标是让页面组件不直接编排所有 API 调用。

### 2. `apps/web/src/components/SettingsPage.tsx`

设置页同时包含供应商列表、连接编辑、模型发现、保存和启用互斥逻辑。建议拆成：

- `ProviderServiceTabs`
- `ProviderList`
- `ProviderEditor`
- `ProviderModelList`
- `useProviderSettings`

供应商类型差异应放在配置 schema 中，避免 JSX 中继续累积供应商分支。

### 3. `apps/web/src/components/ModelingPage.tsx`

查看器已经拆出，剩余内容仍包含输入选择、持久化状态、供应商参数和任务卡。下一步建议拆成：

- `useModelingState`
- `ModelingSourcePanel`
- `ModelingConfigPanel`
- `ModelJobCard`
- `modeling-parameter-schema.ts`

参数校验和参数表单应由同一份 schema 驱动，避免前端和后端各自维护一套条件分支。

## 优先级二：后端边界

### 4. `packages/storage/src/job-repository.ts`

文件同时处理任务创建、查询、状态更新、恢复、输出关系和事件关联。建议按职责拆为：

- `job-command-repository`
- `job-query-repository`
- `job-checkpoint-repository`
- `job-output-repository`

暂时不改变数据库表，先通过 facade 保持现有调用方兼容。

### 5. `apps/api/src/business-routes.ts`

路由文件包含较多业务编排。建议将路由参数解析放在 API 层，把任务提交、供应商设置和资产操作交给 `packages/core` 服务。

### 6. `packages/providers`

各供应商适配器已经有统一接口，但参数解析仍分散在多个文件。建议逐步统一为：

```text
provider schema
  ├─ connection fields
  ├─ model discovery
  ├─ request mapping
  ├─ response mapping
  └─ output packaging
```

这样新增供应商时不会修改设置页、任务页和 Worker 多个位置。

## 暂不处理

- 不迁移数据库。
- 不更换 React 或 API 框架。
- 不在本轮继续加入骨骼、剖切和多模型叠加。
- 不在本轮打包。

这些属于独立变更，应该在当前边界稳定后再做。
