# Enterprise RAG - 企业知识库问答系统

基于 Next.js 16 + PostgreSQL(pgvector) 的企业级 RAG 知识库问答系统。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 数据库配置

#### 前置条件

- PostgreSQL 16+
- pgvector 扩展

#### 安装 pgvector (macOS)

Homebrew 默认安装的 pgvector 可能与你的 PostgreSQL 版本不匹配。如果 `brew install pgvector` 安装的版本不对，需要从源码编译：

```bash
# 下载源码（以 0.8.2 为例）
cd /tmp && curl -L -o pgvector-0.8.2.tar.gz \
  "https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.2.tar.gz"
tar xzf pgvector-0.8.2.tar.gz && cd pgvector-0.8.2

# 指定 PostgreSQL 版本编译安装
PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config make
PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config make install
```

#### 创建数据库和 Schema

```sql
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建 schema
CREATE SCHEMA IF NOT EXISTS enterprise_rag;

-- 设置默认 search_path（替换 your_user 为实际用户名）
ALTER ROLE your_user SET search_path TO enterprise_rag, public;
```

#### 配置环境变量

复制 `.env.example` 为 `.env`，配置数据库连接：

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/postgres
```

> **注意**: `postgres-js` 驱动不支持 `?schema=xxx` 参数（这是 Prisma 的格式）。Schema 通过数据库层面的 `search_path` 控制，不需要在 URL 中指定。

#### 建表和索引

```bash
# 生成迁移文件
npm run db:generate

# 执行迁移（需要 TTY 环境）
npm run db:migrate

# 或者直接推送 schema（开发环境）
npm run db:push

# 如果以上命令在非 TTY 环境下失败，手动执行 SQL
psql -h localhost -U your_user -d postgres -f drizzle/0000_dazzling_tenebrous.sql
```

建表后手动创建索引：

```sql
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_keywords_idx ON chunks USING gin (keywords);
CREATE INDEX IF NOT EXISTS documents_kb_id_idx ON documents (kb_id);
CREATE INDEX IF NOT EXISTS chunks_kb_id_idx ON chunks (kb_id);
```

### 3. 启动服务

```bash
npm run dev
```

访问 http://localhost:3000

## 项目结构

```
src/
├── app/
│   ├── api/           # API 路由
│   │   ├── chat/      # 对话 (SSE 流式)
│   │   ├── documents/ # 文档上传/管理
│   │   ├── knowledge/ # 知识库 CRUD
│   │   └── health/    # 健康检查
│   ├── chat/          # 问答页面
│   └── documents/     # 文档管理页面
├── components/        # UI 组件 (CSS Modules)
└── lib/
    ├── db/            # 数据库 (Drizzle ORM)
    ├── ingestion/     # 文档解析/分块/向量化
    ├── llm/           # LLM 客户端和 prompt
    ├── retrieval/     # 检索 (向量/关键词/Rerank)
    └── auth/          # 权限控制
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DATABASE_URL` | Y | - | PostgreSQL 连接串 |
| `OPENAI_API_KEY` | Y | - | LLM API Key |
| `OPENAI_BASEURL` | N | - | LLM API 地址（如 DeepSeek） |
| `OPENAI_MODEL` | N | gpt-4o | 对话模型 |
| `OPENAI_EMBEDDING_API_KEY` | N | 同 `OPENAI_API_KEY` | Embedding API Key |
| `OPENAI_EMBEDDING_BASEURL` | N | 同 `OPENAI_BASEURL` | Embedding API 地址 |
| `OPENAI_EMBEDDING_MODEL` | N | text-embedding-3-small | 向量模型 |
| `COHERE_API_KEY` | Y | - | Cohere Rerank API Key |
| `SIMILARITY_THRESHOLD` | N | 0.7 | 检索相似度阈值 |
| `CHUNK_SIZE` | N | 500 | 分块字符数 |
| `CHUNK_OVERLAP` | N | 100 | 分块重叠字符数 |

## 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint 检查
npm run db:generate  # 生成 Drizzle 迁移
npm run db:migrate   # 执行数据库迁移
npm run db:push      # 直接推送 schema（开发环境）
npm run docker:up    # 启动 PostgreSQL (Docker)
```
