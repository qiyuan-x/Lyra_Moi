# Lyra Moi

Lyra Moi 是一个图片创作和 AI 建模工具。

## 功能

- Agent 对话：通过自然语言生成和修改图片。
- 手动生图：选择模型、提示词和参考图片生成图片。
- AI 建模：输入图片生成 3D 模型，并查看或下载模型文件。
- 素材库：管理上传图片和生成图片。
- 提示词库：保存和复用提示词模板。

## 使用

### Windows 启动器

1. 解压发布包。
2. 双击 `LyraLauncher.exe`。
3. 点击“启动服务”。
4. 服务启动后打开浏览器。
5. 进入“设置”，配置 LLM、生图和建模供应商。

### 源码运行

```bash
pnpm install
pnpm build
python main.py
```

## 构建

### Windows 发布包

```bash
python -m pip install -r scripts/requirements-build.txt
pnpm package:windows
```

生成文件：

```text
release/LyraLauncher.exe
```

### 服务器构建

服务器需要安装 Docker 和 Docker Compose：

```bash
docker compose -f deploy/server/compose.yaml build
```
