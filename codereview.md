# Enterprise RAG Code Review Report

**Review Date:** 2026-05-03
**Reviewer:** Qoder CLI
**Scope:** Full codebase (`src/` + config)
**Methodology:** 五层 Code Review 体系（静态分析 → 安全 → 测试 → CI → 人工清单）

---

## 执行摘要

| 级别 | 严重 | 高 | 中 | 低 | 总计 |
|------|------|-----|-----|-----|------|
| 安全 (P0) | 2 | 1 | 1 | 0 | 4 |
| 逻辑缺陷 | 0 | 3 | 2 | 2 | 7 |
| TypeScript/类型 | 0 | 0 | 4 | 1 | 5 |
| 性能/可扩展性 | 0 | 1 | 2 | 1 | 4 |
| 代码质量 | 0 | 0 | 1 | 3 | 4 |
| **合计** | **2** | **5** | **10** | **7** | **24** |

**最紧迫的 3 个问题：**
1. `x-user-department` 请求头可被客户端伪造，导致跨部门数据泄露（严重）
2. 文档上传接口未校验写入权限，任意部门可向任意知识库上传文件（严重）
3. 内存限流器存在竞态条件且无进程间共享，多实例部署时完全失效（高）

---

## Layer 1: 静态分析

### L1-1 [中] `noUncheckedIndexedAccess` 未开启
**位置：** `tsconfig.json`
**问题：** 当前 `strict: true` 已启用，但缺少 `noUncheckedIndexedAccess`。代码中存在多处数组/对象索引访问未做空值检查：
- `src/app/api/chat/route.ts:95` `searchResults[0]` 未检查
- `src/components/ChatPanel.tsx:94` `updated[updated.length - 1]!` 强制非空断言
- `src/lib/ingestion/chunker.ts:63` `headingMatch[1]!` 强制非空断言
- `src/lib/retrieval/vector-search.ts:116` `embeddings[i]!`
- `src/lib/retrieval/vector-search.ts:117` `keywordLists[i]!`
**修复：** 在 `tsconfig.json` 中加入 `"noUncheckedIndexedAccess": true`，逐文件修复报错。

### L1-2 [中] `db.execute()` 返回类型强制转换
**位置：** `src/lib/retrieval/vector-search.ts:45,84`
**问题：** `(results as unknown as Record<string, unknown>[]).map(...)` 完全绕过类型检查。若 SQL 查询结构调整（如重命名列），此处会在运行时崩溃。
**修复：** 使用 Drizzle 的 `sql.typed()` 或至少添加运行时字段存在性校验。

### L1-3 [低] 多处 `as` 类型断言
**位置：**
- `src/app/api/chat/route.ts:64` `m.role as 'user' | 'assistant'`
- `src/app/api/knowledge/route.ts:28` `body as { name?; department? }`
- `src/app/api/chat/route.ts:10` `body as { query?; conversationId?; department? }`
**问题：** `as` 断言在编译时掩盖类型不匹配，运行时若收到畸形数据会静默失败或崩溃。
**修复：** 使用 zod/superstruct 做运行时验证，如 ai-agent-apps 项目中建立的 `validateChatRequest` 模式。

### L1-4 [中] `pdf-parse` 包版本不匹配 API
**位置：** `src/lib/ingestion/parser.ts`
**问题：** 项目依赖 `pdf-parse@^2.4.5`，但 npm 上标准的 `pdf-parse` 包最新版是 1.1.1。当前安装的 v2 是一个完全不同的库（基于 pdfjs-dist 的 `PDFParse` 类），API 不兼容标准文档。虽然构建通过，但运行时可能行为异常。
**修复：** 降级到 `pdf-parse@1.1.1`（或 `pdf-parse-new`），并验证解析逻辑。

### L1-5 [低] `eslint.config.mjs` 规则偏宽松
**位置：** 项目根目录
**问题：** 当前仅使用 `eslint-config-next`，未启用 `react-hooks/exhaustive-deps`、`@typescript-eslint/no-explicit-any`、`no-console` 等规则。
**修复：** 参照 ai-agent-apps 的 `eslint.config.mjs` 增强配置。

---

## Layer 2: 安全审查

### L2-1 [严重] 部门身份可被客户端伪造
**位置：**
- `src/app/api/chat/route.ts:13` `department` 来自请求 body
- `src/app/api/knowledge/route.ts:8` `department` 来自 `x-user-department` header
- `src/lib/auth/permissions.ts:27` `getDepartmentFromRequest()` 直接读取 header
**问题：** 没有任何服务端身份验证。攻击者只需在请求中设置 `department: "财务部"` 或 `X-User-Department: 法务部`，即可查询其他部门的私有知识库。
**影响：** 跨部门数据泄露，所有权限隔离失效。
**修复：**
1. 引入身份验证（JWT / Session / OAuth）
2. 从服务端验证过的 token/session 中提取 department
3. 在修复前，至少将 `x-user-department` 改为不可由前端 JS 控制的机制（如 HTTP-only cookie）

### L2-2 [严重] 文档上传无写入权限校验
**位置：** `src/app/api/documents/route.ts:15-81`
**问题：** 上传接口验证了 `kbId` 存在，但完全没有调用 `checkPermission(kbId, department, 'write')`。任何知道 `kbId` 的客户端都可以向任意知识库上传文档。
**影响：** 恶意用户可向其他部门知识库注入伪造文档，污染检索结果。
**修复：** 在处理上传前增加权限检查：
```ts
const canWrite = await checkPermission(kbId, department, 'write');
if (!canWrite) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```

### L2-3 [高] 限流器可被绕过
**位置：** `src/app/api/chat/route.ts:36-46`
**问题：**
1. Rate limit key 是 `chat:${department}`，而 `department` 来自客户端可控的请求 body（见 L2-1）。更换 department 字符串即可重置限流窗口。
2. 内存 `Map` 无并发控制，并发请求可同时通过检查（竞态条件）。
3. 进程级内存存储在多实例/Docker Swarm/K8s 部署下完全不共享，限流形同虚设。
**修复：**
1. 限流 key 应基于用户身份（userId / session / IP），而非部门
2. 使用 Redis + Lua 脚本实现原子限流，或至少用 `node-redis` + `INCR` + `EXPIRE`

### L2-4 [中] 文件类型仅校验扩展名
**位置：** `src/lib/ingestion/parser.ts:110-112`
**问题：** `getFileType()` 仅取文件扩展名，攻击者可将恶意文件重命名为 `.pdf` 上传。
**修复：** 使用 `file-type` 库检测文件的 magic bytes，双重校验扩展名 + MIME type。

### L2-5 [低] 上传文件保存路径使用 content_hash
**位置：** `src/app/api/documents/route.ts:58`
**问题：** `writeFile(path.join(UPLOAD_DIR, `${contentHash}.${fileType}`), buffer)` 虽然使用 hash 作为文件名避免了路径遍历，但同 hash 文件会覆盖已有文件。虽然去重逻辑会先检查，但去重失败后（如并发上传）可能覆盖。
**修复：** 文件名加入唯一标识（如 docId），确保不覆盖。

---

## Layer 3: 测试覆盖

### L3-1 [高] 无任何测试文件
**位置：** 项目根目录
**问题：** 项目中完全没有测试（没有 `vitest.config.ts`、没有 `__tests__`、没有 `*.test.ts`）。
**应优先测试的模块（按 ROI 排序）：**
1. `src/lib/rate-limit.ts` — 纯逻辑，无外部依赖
2. `src/lib/ingestion/chunker.ts` — 纯函数，输入输出明确
3. `src/lib/ingestion/embedder.ts:extractKeywords()` — 纯函数
4. `src/lib/auth/permissions.ts` — 可用内存 SQLite/mock 测试
5. `src/lib/retrieval/hybrid.ts` — mock vector/keyword/rerank 结果，测试合并去重逻辑
**修复：** 安装 `vitest` + `@vitejs/plugin-react`，为上述模块编写单元测试。

### L3-2 [中] 无 API 路由测试
**位置：** `src/app/api/*`
**问题：** 所有 API 路由均为手工测试。chat 路由的 SSE 流逻辑、documents 路由的异步处理、error 分支均未被自动化验证。
**修复：** 使用 `next-test-api-route-handler` 或直接用 `vitest` + `node-mocks-http` 测试路由 handler。

---

## Layer 4: Pre-commit / CI

### L4-1 [中] 无 Husky / lint-staged
**位置：** 项目根目录
**问题：** 没有 `.husky/` 目录，`package.json` 中没有 `lint-staged` 配置。开发者可能提交未格式化或有类型错误的代码。
**修复：** 参照 ai-agent-apps 配置 `husky` + `lint-staged` + `pre-commit` / `pre-push` hooks。

### L4-2 [中] 无 CI 流水线
**位置：** `.github/workflows/`
**问题：** 没有 GitHub Actions 配置。无法自动验证 PR 的构建、类型检查和测试。
**修复：** 添加 `.github/workflows/ci.yml`，包含：
1. `npm run lint`
2. `tsc --noEmit`
3. `npm test`
4. `npm run build`

### L4-3 [低] `package.json` scripts 不完整
**位置：** `package.json`
**问题：** `scripts` 中只有 `dev`, `build`, `start`, `lint`。缺少 `test`、`typecheck`、`format`。
**修复：** 补充 scripts。

---

## Layer 5: 人工审查清单

### 架构层面

#### L5-1 [中] 对话历史硬编码 limit(10)，长对话丢失上下文
**位置：** `src/app/api/chat/route.ts:43`
**问题：** 只取最近 10 条消息发给 LLM。长对话中早期的重要约束/背景会被丢弃。
**修复：** 实现滑动窗口（最近 N 轮）或摘要机制（对早期对话做 LLM 摘要）。

#### L5-2 [低] 消息来源仅在流结束后保存
**位置：** `src/app/api/chat/route.ts:90-99`
**问题：** 用户消息在流开始前写入（正确），但助手消息只在流正常结束时写入。如果客户端断开连接或流异常，助手回复丢失。
**修复：** 考虑流式写入（分段保存）或在关键节点做 checkpoint 保存。

#### L5-3 [低] `kbPermissions.kbId` 缺少 `notNull()` 和主键约束
**位置：** `src/lib/db/schema.ts:58`
**问题：** `kbId` 可为 null，且表无主键。`getAccessibleKbIds()` 中使用 `p.kbId!` 强制断言。若出现 null 行，SQL join 行为不可预测。
**修复：** `kbId` 加 `.notNull()`，并为 `(kbId, department)` 定义复合主键。

#### L5-4 [低] `chunker.ts` 的 overlap 防无限循环逻辑冗余
**位置：** `src/lib/ingestion/chunker.ts:50-53`
**问题：**
```ts
if (start <= end - chunkSize + overlap) {
  start = end;
}
```
当 `overlap >= chunkSize` 时，这段代码会导致 `start = end`，即无重叠直接跳到末尾。更好的做法是在函数入口断言 `overlap < chunkSize`。
**修复：** `if (overlap >= chunkSize) throw new Error('overlap must be less than chunkSize')`。

### React / 前端

#### L5-5 [低] ChatPanel 的 SSE 解析未处理 `AbortError` 后的状态回滚
**位置：** `src/components/ChatPanel.tsx:107-113`
**问题：** 请求失败后向 messages 追加了 `{ role: 'assistant', content: '请求失败，请重试' }`，但之前已有一条空的 assistant message（第 62 行插入）。导致失败时出现两条 assistant 消息。
**修复：** 失败时替换最后一条 assistant message，而非追加。

#### L5-6 [低] DocumentUploader 未限制单文件大小
**位置：** `src/components/DocumentUploader.tsx`
**问题：** 前端无文件大小校验，大文件会先完整上传到服务器才返回 413。浪费带宽和等待时间。
**修复：** 在 `handleUpload` 中增加 `file.size > MAX_SIZE` 的前端拦截。

### AI / LLM 特定

#### L5-7 [中] RAG 系统提示词过于简单
**位置：** `src/lib/llm/prompts.ts`
**问题：** 系统提示只有 3 行，未包含：
- 对引用格式的精确约束（模型可能不遵循 `[来源:文档名/页码]` 格式）
- 多轮对话中避免重复引用的指令
- 对表格/代码等特殊内容的格式化要求
**修复：** 参照 prompt-compress skill 优化提示词，增加 example-based instruction。

#### L5-8 [中] 无检索结果时未提前终止 LLM 调用
**位置：** `src/app/api/chat/route.ts:31`
**问题：** 即使 `hybridSearch` 返回空结果，仍然会调用 `streamChat`，由 LLM 根据 prompt 约束回答"未找到相关资料"。这浪费了一次 LLM API 调用（约 20-50  token 输入成本）。
**修复：** `if (searchResults.length === 0) return 直接响应"未找到相关资料"`，不调用 LLM。

#### L5-9 [低] `streamChat` 的 `formatSources` 函数未使用
**位置：** `src/lib/llm/client.ts`
**问题：** `import { formatSources }` 但代码中未调用，由调用方自行拼接来源字符串。
**修复：** 统一使用 `formatSources` 或移除未使用的导出。

### 性能与可扩展性

#### L5-10 [高] Embedding batch size 仅 100
**位置：** `src/lib/ingestion/embedder.ts:12`
**问题：** OpenAI embedding API 支持最多 2048 个输入 per request。batch size 100 导致大量小请求，增加网络延迟和 API 开销。
**修复：** 提升至 500-1000，或根据 token 数动态计算 batch 大小。

#### L5-11 [中] 文档解析在后台异步执行，无队列/重试
**位置：** `src/app/api/documents/route.ts:74`
**问题：** `processDocument(doc!.id, ...).catch(console.error)` 使用裸 Promise，Node.js 进程崩溃时正在处理的文档永远停留在 `processing` 状态。无重试、无死信队列、无进度查询 API。
**修复：** 引入任务队列（BullMQ / pg-boss）或至少提供 `GET /api/documents/:id/status` 查询接口 + 定时清理任务。

#### L5-12 [中] 数据库连接池配置无环境感知
**位置：** `src/lib/db/index.ts`
**问题：** `DB_MAX_CONNECTIONS` 默认 10。在 Serverless 环境（如 Vercel）中，每个函数实例都会建立 10 个连接，容易打满 PostgreSQL 的 `max_connections`。
**修复：** Serverless 环境应使用 `max: 1` + 外部连接池（PgBouncer），或检测 `VERCEL` 环境变量自动调整。

---

## 修复优先级建议

### P0（立即修复，阻塞上线）
1. **L2-1** — 引入身份验证，禁止客户端直接控制 department
2. **L2-2** — 文档上传增加 `checkPermission(kbId, department, 'write')`
3. **L2-3** — 限流器改为基于用户身份 + Redis 原子操作

### P1（本周内修复）
4. **L3-1** — 补充核心模块单元测试（rate-limit, chunker, embedder）
5. **L5-10** — 提升 embedding batch size 至 500+
6. **L1-1** — 开启 `noUncheckedIndexedAccess`
7. **L5-11** — 文档处理状态查询接口 + 异常清理
8. **L4-1** — 配置 husky + lint-staged

### P2（下月修复）
9. **L2-4** — 文件类型 magic bytes 校验
10. **L5-7** — 优化 RAG 系统提示词
11. **L5-8** — 空检索结果时跳过 LLM 调用
12. **L4-2** — GitHub Actions CI 流水线
13. **L1-4** — 确认并修复 pdf-parse 包版本

### P3（可选优化）
14. **L5-1** — 对话历史滑动窗口
15. **L5-3** — kbPermissions 主键约束
16. **L5-5** — ChatPanel 错误状态处理
17. **L5-6** — 前端文件大小预校验

---

## 附录：参照标准

本 review 基于 ai-agent-apps 项目沉淀的五层 Code Review 体系（见 `~/Downloads/qoder-workspace/AGENTS.md`）。

关键参照文件：
- `ai-agent-apps/eslint.config.mjs` — ESLint 增强规则模板
- `ai-agent-apps/lib/types/api.ts` — 请求体验证模式
- `ai-agent-apps/.husky/` — Git hooks 配置模板
- `ai-agent-apps/.github/workflows/ci.yml` — CI 流水线模板
