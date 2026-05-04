# Enterprise RAG 避坑指南

## 1. pgvector 索引选择

- **数据量 < 100 万**：IVFFlat 足够，构建速度快
- **数据量 > 100 万**：必须用 HNSW，查询速度提升 10-50 倍
- **HNSW 参数**：`m=16, ef_construction=64` 是通用起始值，数据量越大 `ef_construction` 应越大
- **陷阱**：HNSW 索引构建非常耗内存，构建时应确保 PostgreSQL 的 `maintenance_work_mem` >= 1GB

## 2. Chunk Size 不是越大越好

- **500 字符是中文甜蜜点**：太大召回噪音多，太小丢失上下文
- **表格数据**：整表作为一个 chunk，避免行列被切开
- **代码文档**：按函数/类切分，不要按固定长度硬切
- **陷阱**：chunk_size 改变后必须重新生成所有 embedding，旧数据不兼容

## 3. Embedding 模型一致性

- **存储和查询必须用同一个模型**，混用会导致语义空间不匹配，检索精度骤降
- **切换模型**：没有迁移捷径，必须删除旧 chunks，重新解析生成 embedding
- **陷阱**：OpenAI 的 `text-embedding-3-small` 和 `text-embedding-3-large` 维度不同（1536 vs 3072），向量表维度必须匹配

## 4. 中文关键词检索必须分词

- **不能用空格分词**：中文没有天然空格分隔
- **jieba 是必须的**：`nodejieba` 在 Node.js 环境中表现稳定
- **陷阱**：`nodejieba` 有原生编译依赖，Docker 构建时必须安装 `python3 make g++`

## 5. Rerank 是精度提升的关键

- **不做 Rerank**：混合检索收益只有 5-10%
- **做了 Rerank**：精度提升 20-30%
- **fallback 必须**：Cohere API 可能超时或失败，失败后应回退到向量分数排序
- **陷阱**：Rerank 按 token 计费，长文档 chunks 费用高，控制 chunk 长度可降低成本

## 6. 幻觉拒绝需要双保险

- **Prompt 层约束**："仅基于检索到的资料回答，无资料时回答未找到相关资料"
- **检索阈值**：设置 `SIMILARITY_THRESHOLD`（默认 0.7），低于阈值直接拒绝回答
- **单一层都不够用**：prompt 可能被模型忽略，阈值可能漏掉边缘 relevant 内容
- **陷阱**：阈值过高导致"该知道的不知道"，阈值过低导致幻觉，需要业务数据调优

## 7. 权限隔离必须在数据库层

- **不要在应用层过滤**：应用层过滤有 bypass 风险，且大数据量时性能差
- **SQL 层过滤**：所有检索 SQL 必须带 `WHERE kb_id IN (SELECT kb_id FROM kb_permissions WHERE department = $1 AND can_read = true)`
- **陷阱**：Drizzle ORM 的 `with` 关系查询可能生成没有权限过滤的 SQL，手写 raw SQL 更安全

## 8. 文件系统与 Docker

- **上传目录持久化**：`uploads` 目录必须挂载为 Docker volume，否则容器重启文件丢失
- **路径问题**：容器内和宿主机路径不同，`UPLOAD_DIR` 应使用容器内绝对路径 `/app/uploads`
- **陷阱**：Turbopack 对 `fs/promises` 的静态分析会报警告，不影响运行但需确认路径使用 `process.cwd()`

## 9. API Key 与构建时错误

- **不要在模块顶层初始化 API Client**：`new OpenAI()` 在 `npm run build` 时会执行，若环境变量未设置则构建失败
- **懒加载模式**：用 `getOpenAI()` 函数包装，第一次调用时才初始化
- **陷阱**：Next.js 构建时会预渲染页面并执行服务端代码，任何顶层副作用都会触发

## 10. 数据库连接池

- **默认无连接池限制**：`postgres` 驱动默认 `max: 10`，生产环境根据并发量调整
- **连接泄漏**：长连接 + 无超时设置会导致 PG 连接数打满
- **配置建议**：`max: 10-20`, `idle_timeout: 20`, `connect_timeout: 10`
- **陷阱**：Serverless 环境（Vercel）每次请求新建连接，必须用连接池中间件或外部代理（PgBouncer）

## 11. 增量更新与去重

- **content_hash 用 sha256**：MD5 有碰撞风险，尤其大文件
- **增量更新流程**：标记旧 doc `status='pending'` -> 删除旧 chunks -> 重新解析 -> 写入新 chunks
- **陷阱**：直接更新 chunks 而不删除旧数据会导致同一文档出现重复 chunks

## 12. SSE 流式响应异常处理

- **客户端断连**：SSE 流中途断开时，`ReadableStream` 的 `cancel` 不会自动触发，需监听 `request.signal`
- **数据库写入**：在流结束后写入 message 记录，若流中断则记录丢失
- **建议**：重要数据（如消息记录）在流开始前或关键节点同步写入，不要全部放到流结束
