# Lyra Moi

Lyra Moi 是一个面向图片创作和 AI 建模的本地工作区。

## 功能

- Agent 对话：用自然语言创建图片任务、引用素材并迭代修改。
- 手动生图：选择供应商、模型、提示词和参考图片后创建任务。
- AI 建模：输入模型图和可选纹理图，生成 GLB、OBJ、FBX 等文件，并在网页查看 GLB。
- 项目隔离：每个项目独立保存对话、任务、上传素材和生成结果。
- 素材库和提示词库：统一管理图片、模型和可复用提示词。
- 多供应商：LLM、生图和建模供应商分别配置，互不复用。
- Windows 启动器：启动、停止服务，查看日志，并自动打开浏览器。

## Windows 使用（推荐）

发布包不需要安装 Node.js、npm 或 Python。

1. 下载并解压 `LyraLauncher-0.0.1.zip`。
2. 双击 `LyraLauncher.exe`。
3. 点击“启动服务”，服务就绪后打开浏览器。
4. 在“设置”中分别配置 LLM、生图和建模供应商的 API Key。

启动器会在自身目录下创建 `data/`，不会把运行数据写入其他位置。停止服务、查看日志和重新打开浏览器也可以在启动器中完成。

## 从源码运行

要求：Node.js 22.19+、pnpm 11+、Python 3.10+。

```bash
pnpm install
pnpm build
python main.py
```

常用命令：

```bash
python main.py --start
python main.py --status
python main.py --stop
pnpm check
```

开发配置参考 `.env.example`。运行时的 API Key 保存在 `data/config/.env`，该文件已被 Git 忽略，不应提交。

## 服务器部署

服务器部署使用 Docker Compose：

```bash
cd deploy/server
copy server.env.example .env
docker compose --env-file .env up -d --build
```

生产环境请修改 `.env` 中的访问令牌、端口和数据卷配置。详细说明见 [`deploy/server/README.md`](deploy/server/README.md)。

## 项目结构

```text
apps/web       Web 前端
apps/api       HTTP API
apps/worker    Agent、生图和建模任务 Worker
apps/launcher  Windows 服务启动器
packages/      核心业务、契约、存储、供应商和 Agent 模块
resources/     默认提示词和资源
scripts/       构建、迁移和打包脚本
tests/         单元、集成和端到端测试
data/          本地运行数据（不提交）
```

## Windows 打包

安装打包依赖后执行：

```bash
python -m pip install -r scripts/requirements-build.txt
pnpm package:windows
```

脚本会停止已有服务、清理旧构建、构建前后端和启动器，并生成 `release/`。发布包中的持久化数据只写入 `LyraLauncher.exe` 同级的 `data/`。
