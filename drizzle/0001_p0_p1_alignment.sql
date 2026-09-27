-- 0001_p0_p1_alignment
-- 说明：drizzle-kit 基于 0000 snapshot 生成后，按真实数据库状态修正：
--   1) 真实库未安装 pgvector 扩展，chunks 表不存在 embedding 列（ADD COLUMN 而非 ALTER TYPE）
--   2) 业务表位于 enterprise_rag schema（依靠角色 search_path 解析，不写 public 限定）
--   3) 全部 DDL 幂等，可重复执行
-- 结构等价于 drizzle snapshot 0001，可与 drizzle-kit 生成的版本互换。

-- pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- 文档摄入任务表
CREATE TABLE IF NOT EXISTS "ingestion_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"kb_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"file_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-3-small',
	"status" text NOT NULL DEFAULT 'queued',
	"current_step" text DEFAULT 'parse',
	"retry_count" integer NOT NULL DEFAULT 0,
	"max_retries" integer NOT NULL DEFAULT 3,
	"last_error" text,
	"last_heartbeat" timestamp with time zone NOT NULL DEFAULT now(),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- chunks：embedding 列在真实库中缺失，直接新增 1024 维向量列
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "heading_path" text;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "token_count" integer;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "block_type" text;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "parent_chunk_id" uuid;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_model" text;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "search_tsvector" tsvector;
--> statement-breakpoint

-- documents：P1 文档版本/血缘/元数据列
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source_id" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parent_document_id" uuid;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "effective_from" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "effective_to" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parser_version" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding_model" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding_dimension" integer;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint

-- 同库内容哈希唯一约束（幂等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_kb_content_hash') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "unique_kb_content_hash" UNIQUE ("kb_id", "content_hash");
  END IF;
END $$;
--> statement-breakpoint

-- ingestion_tasks 外键（幂等，引用走 search_path 解析到 enterprise_rag）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_tasks_doc_id_documents_id_fk') THEN
    ALTER TABLE "ingestion_tasks" ADD CONSTRAINT "ingestion_tasks_doc_id_documents_id_fk"
      FOREIGN KEY ("doc_id") REFERENCES "documents"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_tasks_kb_id_knowledge_bases_id_fk') THEN
    ALTER TABLE "ingestion_tasks" ADD CONSTRAINT "ingestion_tasks_kb_id_knowledge_bases_id_fk"
      FOREIGN KEY ("kb_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

-- 检索与运维索引
CREATE INDEX IF NOT EXISTS "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_search_tsvector_idx" ON "chunks" USING gin ("search_tsvector");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_kb_status_idx" ON "documents" ("kb_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_deleted_at_idx" ON "documents" ("deleted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_tasks_status_idx" ON "ingestion_tasks" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_tasks_heartbeat_idx" ON "ingestion_tasks" ("status", "last_heartbeat");
