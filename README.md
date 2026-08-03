# Lyra Moi

Lyra Moi 是一个图片创作和 AI 建模工具。

## 功能

- Agent 对话：通过自然语言生成和修改图片。
- 手动生图：选择模型、提示词和参考图片生成图片。
- AI 建模：输入图片生成 3D 模型，并查看或下载模型文件。
- 素材库：管理上传图片和生成图片。
- 提示词库：保存和复用提示词模板。

## 使用方式

### Windows 启动器

1. 解压发布包。
2. 双击 `LyraLauncher.exe`。
3. 点击“启动服务”。
4. 服务启动后打开浏览器。
5. 在“设置”中分别配置 LLM、生图和建模 API Key。

运行数据会保存在启动器同级的 `data/` 文件夹中。

### 从源码构建和运行

需要 Node.js 22.19+、pnpm 11+ 和 Python 3.10+：

```bash
pnpm install
pnpm build
python main.py
```

### 服务器部署

服务器使用 Docker 从源码构建：

```bash
git clone <仓库地址>
cd Lyra_Moi/deploy/server
cp server.env.example .env
```

修改 `.env` 中的 `LYRA_ACCESS_TOKEN`，然后构建并启动：

```bash
docker compose --env-file .env up -d --build
```

浏览器访问 `http://服务器地址:8080`。停止服务：

```bash
docker compose --env-file .env down
```

API Key 只保存在本地 `data/config/.env`，不要提交到 GitHub。
