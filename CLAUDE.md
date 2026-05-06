@AGENTS.md

# Enterprise RAG - 企业知识库问答系统

## 项目概述

基于 Next.js 16 + PostgreSQL(pgvector) 的企业级 RAG（检索增强生成）知识库问答系统。用户上传企业文档，系统自动解析、分块、向量化存储，通过混合检索为 LLM 提供精准上下文，实现基于企业私有知识的问答。

## 技术栈

- **框架**: Next.js 16.2.4 (App Router, React 19)
- **UI**: CSS Modules（已移除 Tailwind CSS）
- **数据库**: PostgreSQL 16 + pgvector (向量存储)
- **ORM**: Drizzle ORM (schema-first, 类型安全)
- **Embedding**: 阿里云 DashScope `text-embedding-v3` (1024 维)
- **LLM**: DeepSeek `deepseek-v4-pro` (SSE 流式响应)
- **Rerank**: Cohere `rerank-v3.5`（当前已禁用，见下方说明）
- **文档解析**: pdf-parse, mammoth (docx), xlsx
- **测试**: Vitest

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        # 对话 API (POST, SSE 流式)
│   │   ├── documents/route.ts   # 文档上传/列表 API
│   │   ├── documents/[id]/route.ts # 文档详情/删除 API
│   │   ├── knowledge/route.ts   # 知识库 CRUD API
│   │   └── health/route.ts      # 健康检查
│   ├── chat/page.tsx            # 问答页面
│   ├── documents/page.tsx       # 文档管理页面
│   └── page.tsx                 # 首页 (导航入口)
├── components/
│   ├── ChatPanel.tsx            # 聊天面板组件
│   └── DocumentUploader.tsx     # 文档上传组件
└── lib/
    ├── auth/permissions.ts      # 部门级权限控制
    ├── db/
    │   ├── index.ts             # 数据库连接 (postgres-js 连接池)
    │   ├── schema.ts            # Drizzle 表结构定义
    │   └── migrate.ts           # 数据库索引创建
    ├── ingestion/
    │   ├── parser.ts            # 文档解析 (PDF/DOCX/XLSX/TXT/MD)
    │   ├── chunker.ts           # 文档分块 (500 字符, 100 重叠)
    │   └── embedder.ts          # 向量生成 + 关键词提取
    ├── llm/
    │   ├── client.ts            # LLM 流式对话客户端
    │   └── prompts.ts           # RAG 系统提示词
    ├── retrieval/
    │   ├── vector-search.ts     # 向量检索 + 关键词检索
    │   ├── hybrid.ts            # 混合检索 (向量 + 关键词)
    │   └── reranker.ts          # Cohere Rerank（当前禁用，直接返回 topN）
    └── rate-limit.ts            # 内存限流 (IP + 部门维度)
```

## 核心流程

1. **文档入库**: 上传 -> 文件类型校验(magic bytes) -> 解析(按页/段) -> 分块(500 字符, 100 重叠) -> 生成 embedding(1024维) + 关键词 -> 存入 pgvector
2. **检索问答**: 用户提问 -> 向量检索(cosine, 阈值 0.7) + 关键词检索(GIN 索引) -> 合并去重 -> 拼接上下文 -> DeepSeek 流式回答(带来源标注)

## 数据库配置

- **Schema**: 所有表在 `enterprise_rag` schema 下（非 `public`）
- **Search Path**: 通过 `ALTER ROLE ... SET search_path TO enterprise_rag, public` 配置，应用无需在 URL 中指定 schema
- **连接**: `postgres-js` 驱动，不支持 `?schema=xxx` 参数（Prisma 格式），schema 通过数据库层面 search_path 控制
- **pgvector**: 从源码编译安装（Homebrew 默认版本与 PG 16 不兼容）

### 数据库表

| 表 | 说明 |
|------|------|
| `knowledge_bases` | 知识库 (id uuid, name, department) |
| `documents` | 文档 (id uuid, kb_id FK, filename, file_type, content_hash, status) |
| `chunks` | 分块 (id uuid, doc_id FK, kb_id FK, content, embedding vector(1024), keywords text[], page_num, section_title) |
| `conversations` | 对话 (id uuid, user_id, department, title) |
| `messages` | 消息 (id uuid, conversation_id FK, role, content, sources jsonb) |
| `kb_permissions` | 权限 (kb_id FK, department, can_read, can_write)，复合主键 |

### 索引

- `chunks_embedding_idx`: HNSW 向量索引 (cosine)
- `chunks_keywords_idx`: GIN 关键词数组索引
- `documents_kb_id_idx`: B-tree
- `chunks_kb_id_idx`: B-tree

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DATABASE_URL` | Y | - | PostgreSQL 连接串 |
| `OPENAI_API_KEY` | Y | - | LLM API Key (DeepSeek) |
| `OPENAI_BASEURL` | N | - | LLM API 地址 |
| `OPENAI_MODEL` | N | gpt-4o | 对话模型 |
| `OPENAI_EMBEDDING_API_KEY` | N | 同 `OPENAI_API_KEY` | Embedding API Key |
| `OPENAI_EMBEDDING_BASEURL` | N | 同 `OPENAI_BASEURL` | Embedding API 地址 |
| `OPENAI_EMBEDDING_MODEL` | N | text-embedding-3-small | 向量模型 |
| `COHERE_API_KEY` | N | - | Cohere Rerank API Key（当前未启用） |
| `SIMILARITY_THRESHOLD` | N | 0.7 | 检索相似度阈值 |
| `CHUNK_SIZE` | N | 500 | 分块字符数 |
| `CHUNK_OVERLAP` | N | 100 | 分块重叠字符数 |
| `RATE_LIMIT_MAX` | N | 10 | 限流窗口内最大请求数 |
| `DB_MAX_CONNECTIONS` | N | 10 | 数据库连接池大小 |

## 关键设计决策

- **懒加载 API Client**: OpenAI/Cohere 客户端用 `getOpenAI()`/`getCohere()` 包装，避免构建时因缺少环境变量报错
- **Embedding 独立配置**: LLM 和 Embedding 使用不同的 API（DeepSeek 不支持 embedding），通过 `OPENAI_EMBEDDING_*` 系列变量单独配置
- **数据库层权限过滤**: 所有检索 SQL 必须先通过 `getAccessibleKbIds(department)` 获取可访问的知识库 ID
- **幻觉双保险**: prompt 层约束("仅基于资料回答") + 检索阈值 `SIMILARITY_THRESHOLD=0.7`
- **混合检索**: 向量检索(语义) + 关键词检索(精确匹配, 中文 2-4 字滑动窗口分词)并行执行，合并后返回
- **Rerank 降级**: Cohere Rerank 当前禁用（API 返回 403），直接按向量分数排序返回 topN
- **Drizzle sql 模板**: 使用 `sql` 模板标签时，JS 数组不能直接传给 `ANY()`，需要用 `ARRAY[...]::uuid[]` 显式构造

## 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建
npm run test         # 运行测试 (vitest)
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint 检查
npm run db:generate  # 生成 Drizzle 迁移
npm run db:migrate   # 执行数据库迁移（需 TTY 环境）
npm run db:push      # 直接推送 schema（开发环境，需 TTY）
npm run docker:up    # 启动 PostgreSQL (Docker)
```

## 开发注意事项

- 修改 `CHUNK_SIZE` 后必须重新生成所有 embedding，旧数据不兼容
- 切换 Embedding 模型同理，维度不同需要重建向量表（当前 1024 维）
- 中文关键词检索使用 2-4 字符滑动窗口，不是 jieba 分词（当前实现未引入 nodejieba 依赖）
- SSE 流式响应中，assistant 消息在流结束后才写入数据库，中断会导致消息丢失
- 部门通过请求头 `x-user-department` 传递，默认为 `default`
- `src/lib/db/schema.ts` 中的 `vector` 类型需要 pgvector 扩展
- 上传文档前需先通过 `POST /api/knowledge` 创建知识库获取 UUID，文档上传的 `kbId` 必须是合法 UUID
- `drizzle-kit push` 在非 TTY 环境下会报错，需手动执行 SQL 迁移文件
