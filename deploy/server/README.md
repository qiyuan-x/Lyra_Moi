# Lyra 服务器部署

## 启动

1. 复制环境变量示例：

   ```bash
   cp server.env.example .env
   ```

2. 修改 `.env` 中的 `LYRA_ACCESS_TOKEN`。建议使用至少 32 字节的随机值。
3. 构建并启动：

   ```bash
   docker compose --env-file .env up -d --build
   ```

4. 打开 `http://服务器地址:8080`，输入同一个访问令牌。

## 服务

- `web`：Nginx 静态前端和 `/api` 反向代理。
- `api`：HTTP API、数据库迁移和健康检查。
- `worker`：Agent 和图片任务执行。
- `lyra-data`：SQLite、素材、缩略图、配置和日志持久卷。

健康检查：

```bash
curl http://127.0.0.1:8080/api/v1/health/live
curl http://127.0.0.1:8080/api/v1/health/ready
```

更新单个服务：

```bash
docker compose --env-file .env up -d --build api
docker compose --env-file .env up -d --build worker
docker compose --env-file .env up -d --build web
```

停止服务不会删除数据卷：

```bash
docker compose --env-file .env down
```
