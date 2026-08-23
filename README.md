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
release/Lyra-<version>-windows-x64.zip
release/Lyra-update-<version>-windows-x64.zip
release/update-artifact.json
```

### 网页一键升级

桌面版会在网页左上角显示版本号。点击版本号可检查版本；发现新版本后可直接下载、校验、安装并重启服务。升级失败时会恢复应用目录和升级前的数据库。

发布包固定使用以下更新清单，地址会写入 `release/release.json`，不在普通设置中提供修改入口：

```text
https://linfrsot.cloud/lyra/updates/latest.json
```

更新清单格式：

```json
{
  "schemaVersion": 1,
  "version": "0.0.4",
  "publishedAt": "2026-08-21T00:00:00Z",
  "releaseNotes": ["更新说明"],
  "artifacts": {
    "windows-x64": {
      "url": "https://linfrsot.cloud/lyra/updates/packages/Lyra-update-0.0.4-windows-x64.zip",
      "sha256": "64 位 SHA-256",
      "size": 12345678
    }
  }
}
```

`update-artifact.json` 会给出安装包文件名、大小和 SHA-256，可用于生成更新清单。用户数据始终保存在 `data/`，更新包只替换 `app/` 和 `release.json`。

### 服务器构建

服务器需要安装 Docker 和 Docker Compose：

```bash
docker compose -f deploy/server/compose.yaml build
```
