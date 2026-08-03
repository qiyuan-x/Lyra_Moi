# 浏览器端到端测试

该目录保存真实浏览器工作流测试，不写入项目 `data/`。

准备环境：

```bash
python -m pip install -r tests/e2e/requirements.txt
pnpm build
```

运行：

```bash
pnpm test:e2e
```

测试会启动临时 API、Worker 和模拟 OpenAI 兼容供应商，覆盖：

- 设置页面自动保存 OpenAI 兼容 URL 和 API Key。
- 使用最新 API Key 测试连接并刷新模型下拉框。
- 从模型下拉框分别选择默认 LLM 和图片模型。
- 素材栏收起、展开和状态恢复。
- 两张素材上传和附件排序。
- Agent 与手动模式切换。
- Agent 调用图片工具、生成中状态和恢复。
- 浏览器关闭后重新加载对话与任务。
- 生成结果再次作为素材引用。
- Agent 和手动结果进入同一素材库。
- 通知显示和手动关闭。

可通过 `LYRA_E2E_BROWSER` 指定 Chromium、Edge 或 Chrome 可执行文件。
