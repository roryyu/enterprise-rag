# Enterprise RAG 部署指南

## 环境要求

- Docker >= 24.0
- Docker Compose >= 2.20
- 至少 4GB 可用内存（PG + App）
- 网络可访问 OpenAI API 和 Cohere API

## 快速启动（开发环境）

```bash
# 1. 启动 PostgreSQL
cd docker
docker compose up -d

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 和 COHERE_API_KEY

# 3. 运行数据库迁移
npx drizzle-kit migrate

# 4. 创建索引
# 应用首次启动时会自动执行 src/lib/db/migrate.ts

# 5. 启动开发服务器
npm run dev
```

## 生产部署

### 1. 准备环境变量

创建 `.env` 文件：

```env
# 必填
OPENAI_API_KEY=sk-...
COHERE_API_KEY=...
POSTGRES_PASSWORD=strong_password_here

# 可选（有默认值）
OPENAI_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
MAX_FILE_SIZE_MB=50
CHUNK_SIZE=500
CHUNK_OVERLAP=100
SIMILARITY_THRESHOLD=0.7
RATE_LIMIT_MAX=10
RATE_LIMIT_WINDOW_MS=60000
DB_MAX_CONNECTIONS=10
```

### 2. 使用 Docker Compose 部署

```bash
cd docker
docker compose -f docker-compose.prod.yml up -d --build
```

### 3. 验证部署

```bash
# 健康检查
curl http://localhost:3000/api/health

# 预期响应
{"status":"ok","db":"connected"}
```

### 4. 创建知识库

```bash
curl -X POST http://localhost:3000/api/knowledge \
  -H "Content-Type: application/json" \
  -d '{"name":"产品手册","department":"研发部"}'
```

## 生产优化配置

### PostgreSQL 调优

已在 `docker-compose.prod.yml` 中配置：

```yaml
command: >
  postgres
  -c max_connections=200
  -c shared_buffers=256MB
  -c effective_cache_size=768MB
```

若服务器内存 > 8GB，建议：

```yaml
-c shared_buffers=1GB
-c effective_cache_size=3GB
-c work_mem=32MB
```

### 数据库连接池

通过环境变量控制：

```env
DB_MAX_CONNECTIONS=20
```

### 文件上传大小

```env
MAX_FILE_SIZE_MB=100
```

## 监控与运维

### 日志查看

```bash
# 应用日志
docker logs -f enterprise-rag-app

# 数据库日志
docker logs -f enterprise-rag-db
```

### 数据库备份

```bash
# 手动备份
docker exec enterprise-rag-db pg_dump -U rag_admin enterprise_rag > backup.sql

# 恢复
docker exec -i enterprise-rag-db psql -U rag_admin enterprise_rag < backup.sql
```

### 更新部署

```bash
cd docker
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build
```

## 故障排查

| 现象 | 可能原因 | 解决 |
|------|---------|------|
| 构建失败 `Missing credentials` | API Client 顶层初始化 | 检查是否使用懒加载模式 |
| 上传文件后状态一直是 processing | 文档解析失败 | 查看应用日志，检查文件格式 |
| 检索结果为空 | 阈值过高或未入库 | 降低 SIMILARITY_THRESHOLD，检查文档状态 |
| 回答出现幻觉 | 阈值过低 + 未触发拒绝 | 提高阈值，检查 prompt 是否生效 |
| 数据库连接报错 | 连接池耗尽 | 增加 DB_MAX_CONNECTIONS 或检查连接泄漏 |
| 容器启动后无法连接 | 数据库未就绪 | 确认 healthcheck 通过后再启动 app |

## 安全建议

1. **不要使用默认密码**：`POSTGRES_PASSWORD` 必须更换强密码
2. **API Key 不要提交到 Git**：`.env` 已加入 `.gitignore`
3. **生产环境加 Nginx 反向代理**：启用 HTTPS 和请求日志
4. **定期备份**：PostgreSQL 数据卷需定时备份
5. **上传文件扫描**：生产环境建议对上传文件做病毒扫描
