# Lyra Moi

Lyra Moi 是一个调用API进行图片创作和 AI 建模工具，主要是聚合了AI图片生成到模型生成的创作流程。

## 功能

- Agent 对话：支持自动计划、应用工具调用、子智能体协作和执行恢复。
- 图片生成：选择模型、提示词和参考图片生成图片。
- AI 建模：输入图片生成 3D 模型，在素材库预览或下载；多个输出文件合为 ZIP，存放路径显示在页面底部。
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

需要 Node.js 22.19+、pnpm 和 Python 3.12（含 Tkinter）。构建产物供启动器使用，不能在构建成功后再执行 `pnpm clean`；`pnpm typecheck` 不再删除启动产物。

```bash
pnpm install
pnpm build
python main.py
```

### 项目目录与数据迁移

- 升级程序不需要替换数据库。保留本机 `data`，不要用另一安装的 `database/lyra.sqlite3` 或 `.env` 覆盖它。
- 升级/回退只替换 `app` 程序目录，安装前会备份并在失败时恢复 `data/database`；对话、图片任务和模型任务会继续保留。任务显示按当前项目筛选，请在项目切换器选择原任务所属项目。
- 新版会在项目目录维护 `lyra-project.json`，保存项目名称、素材 ID、名称、标签、文件校验及删除状态。动作库继续使用 `animations/index.json`。
- 停止源、目标服务后，把完整的 `data/projects/<项目 ID>` 复制到目标 `data/projects`，保留目录名及内部文件，重启目标服务即可识别。已存在的项目 ID 不覆盖、不合并；不要把另一个项目的文件塞入已有 ID 的目录。
- 0.0.7 的项目若没有独立索引，新版会对未注册目录扫描 `uploads/images`、`generated/images`、`generated/models` 并重建素材索引；不会把缩略图和临时文件当素材。原始文件不删除。
- 项目目录迁移范围为项目信息、素材及动作。对话、任务历史和全局供应商设置仍在中央数据库中，不会从文件名推断，也不会自动复制凭据。完整迁移所有数据应备份并转移整套 `data` 到空目标，不能覆盖已有工作区。
- 对已知项目以中央数据库为准；修改项目名、素材名、标签和删除素材会更新独立索引。缺失、校验失败、路径越界或索引版本不支持的目录不导入，原因记录在 API/Worker 日志中。

需要手动修复识别时，先构建并停止服务，再运行 `node scripts/repair-project-folders.mjs`。该脚本先备份当前 SQLite（包括 WAL 中已提交的数据）到 `data/backups`，只新增项目和素材索引，不替换现有数据库。

### Windows 打包

```powershell
python -m pip install -r scripts/requirements-build.txt
python scripts/stop-launcher-services.py
pnpm build
python scripts/build-release.py --output-dir release/新版本目录
```

输出目录必须位于 `release` 下，且为空或尚未创建。已有目录中的配置、任务与测试结果不会被打包脚本清除；重新打包请使用新的目录。`pnpm clean` 只清理编译产物，不删除 `release`。

发布包不包含正在使用的 `data` 或 API Key。升级已有安装时，先停止该安装的服务并备份，再替换程序文件，保留原 `data`。
