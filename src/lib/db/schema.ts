import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  primaryKey,
  unique,
  customType,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

// PostgreSQL tsvector 类型（drizzle-orm 0.45 未内置 builder）
const tsVector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

// 知识库
export const knowledgeBases = pgTable("knowledge_bases", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  department: text("department").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 文档
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  kbId: uuid("kb_id").references(() => knowledgeBases.id),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").default("pending").notNull(), // pending/processing/done/failed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // 文档版本与血缘
  version: integer("version").default(1),
  sourceId: text("source_id"),
  parentDocumentId: uuid("parent_document_id"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  // 解析与嵌入元数据
  parserVersion: text("parser_version"),
  embeddingModel: text("embedding_model"),
  embeddingDimension: integer("embedding_dimension"),
  metadata: jsonb("metadata"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  // 同一知识库内内容哈希唯一（应用层 + 数据库层双重去重）
  unique("unique_kb_content_hash").on(table.kbId, table.contentHash),
]);

// 文档分块
export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  docId: uuid("doc_id").references(() => documents.id),
  kbId: uuid("kb_id").references(() => knowledgeBases.id),
  content: text("content").notNull(),
  pageNum: integer("page_num"),
  sectionTitle: text("section_title"),
  chunkIndex: integer("chunk_index").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
  keywords: text("keywords").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // 分块结构信息
  headingPath: text("heading_path"),
  tokenCount: integer("token_count"),
  blockType: text("block_type"), // paragraph | heading | table | list | code
  parentChunkId: uuid("parent_chunk_id"),
  // 嵌入版本管理
  embeddingModel: text("embedding_model"),
  embeddingVersion: integer("embedding_version").default(1),
  searchTsvector: tsVector("search_tsvector"), // 全文检索向量列
});

// 对话
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  department: text("department").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 消息
export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  role: text("role").notNull(), // user/assistant
  content: text("content").notNull(),
  sources: jsonb("sources"), // [{chunkId, docName, page, section}]
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 权限
export const kbPermissions = pgTable(
  "kb_permissions",
  {
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id),
    department: text("department").notNull(),
    canRead: boolean("can_read").default(true),
    canWrite: boolean("can_write").default(false),
  },
  (table) => [primaryKey({ columns: [table.kbId, table.department] })],
);

// 文档摄入任务
export const ingestionTasks = pgTable("ingestion_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  docId: uuid("doc_id").references(() => documents.id).notNull(),
  kbId: uuid("kb_id").references(() => knowledgeBases.id).notNull(),
  filePath: text("file_path").notNull(),
  fileType: text("file_type").notNull(),
  contentHash: text("content_hash").notNull(),
  embeddingModel: text("embedding_model").default("text-embedding-3-small"),
  status: text("status").default("queued").notNull(),
  // queued | parsing | chunking | embedding | indexing | ready | failed_retryable | failed_permanent
  currentStep: text("current_step").default("parse"),
  // parse | normalize | chunk | embed | persist | publish
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  lastError: text("last_error"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
