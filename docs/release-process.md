# 发布约定

## GitHub Release

每次发布新版本时，GitHub Release **只上传 Windows 用户使用包**：

```text
release/Lyra-{version}-windows-x64.zip
```

不要上传以下文件到 GitHub Release：

- `Lyra-update-{version}-windows-x64.zip`
- `latest.json`
- `update-artifact.json`
- 单独的 `LyraLauncher.exe`
- `release/app/`、`release/runtime/`、`release/data/`

GitHub Release 的标签和标题均使用版本号，例如：

```text
标签：v0.0.6
标题：Lyra 0.0.6
```

## 自动更新文件

自动更新文件不放在 GitHub Release。接入更新服务器或 COS 时再分别上传：

```text
release/latest.json
release/Lyra-update-{version}-windows-x64.zip
```

## 发布步骤

1. 更新项目版本号和发布说明。
2. 停止源码目录及旧发布目录中的 API、Worker 和启动器进程。
3. 执行完整测试和生产构建。
4. 执行 `pnpm run package:windows`，脚本会清理旧产物并验证发布包。
5. 提交并推送源码，创建对应的 `v{version}` 标签。
6. 创建 GitHub Release，只上传 `Lyra-{version}-windows-x64.zip`。
7. 确认 Git 仓库中没有提交 `release/`、`build/` 或其他编译产物。

本地测试时，将 Windows 用户使用包解压到空目录，再运行其中的
`LyraLauncher.exe`。
