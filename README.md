# Lyra Moi

Lyra Moi 是一个调用API进行图片创作和 AI 建模工具，主要是聚合了AI图片生成到模型生成的创作流程。

## 功能

- Agent 对话：通过自然语言让大模型智能调用工具进行生成，修改图片或者生成模型等。
- 图片生成：选择模型、提示词和参考图片生成图片。
- AI 建模：输入图片生成 3D 模型，并查看或下载模型文件。
- 动作参考：可以摆pose，然后截图便于让AI理解你想要的姿势。
- 素材库：管理上传图片和生成图片。
- 提示词库：保存和复用提示词模板。

## 使用

### Windows 启动器

1. 解压发布包。
2. 双击 `LyraLauncher.exe`。
3. 点击“启动服务”。
4. 服务启动后打开浏览器。
5. 进入“设置”，配置 LLM、生图和建模供应商API。

### 源码运行

```bash
pnpm install
pnpm build
python main.py
```

### Docker 部署

需要安装 Docker 和 Docker Compose。

1. 进入部署目录，创建服务器配置文件。

   Windows PowerShell：

   ```powershell
   cd deploy/server
   Copy-Item server.env.example .env
   ```

   Linux：

   ```bash
   cd deploy/server
   cp server.env.example .env
   ```

2. 打开 `.env`，将 `LYRA_ACCESS_TOKEN` 设置为自己的服务器访问令牌：随意填写，最好复杂一些。

   ```env
   LYRA_ACCESS_TOKEN=换成自己的长随机字符串
   LYRA_HTTP_PORT=8080
   ```

3. 构建并启动服务：

```bash
docker compose --env-file .env up -d --build
```

部署完成后访问 `http://服务器地址:8080`，并输入 `.env` 中的访问令牌。
