# Lyra Moi

Lyra Moi 是一个调用API进行图片创作和 AI 建模工具，主要是聚合了AI图片生成到模型生成的创作流程。

## 功能

- Agent 对话：支持自动计划、应用工具调用、子智能体协作和执行恢复。
- 图片生成：选择模型、提示词和参考图片生成图片。
- AI 建模：输入图片生成 3D 模型，在素材库预览或下载；
- 动作参考：可以摆pose，然后截图便于让AI理解你想要的姿势。
- 素材库：管理上传图片和生成图片。
- 提示词库：保存和复用提示词模板，查看输入图与效果图。
- 账号管理：支持 API Key，以及受支持供应商的 OAuth 和 Token/JSON 导入、账号状态、额度查询与模型测试。

## 使用

### Windows 启动器

1. 从 [GitHub Releases](https://github.com/qiyuan-x/Lyra_Moi/releases/latest) 下载并解压 Windows 发布包。
2. 双击 `LyraLauncher.exe`。
3. 点击“启动服务”。
4. 服务启动后打开浏览器。
5. 进入“设置”，配置 LLM、生图和建模供应商API。

### 源码运行

需要 Node.js 22.19+、pnpm 和 Python 3.12（含 Tkinter）。

```bash
git clone https://github.com/qiyuan-x/Lyra_Moi.git
cd Lyra_Moi
pnpm install
pnpm build
python main.py
```

启动器打开后点击“启动服务”，在浏览器页面的“设置”中配置需要使用的供应商。
