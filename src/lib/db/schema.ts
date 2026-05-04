import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';

// 知识库
export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  department: text('department').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 文档
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  kbId: uuid('kb_id').references(() => knowledgeBases.id),
  filename: text('filename').notNull(),
  fileType: text('file_type').notNull(),
  contentHash: text('content_hash').notNull(),
  status: text('status').default('pending').notNull(), // pending/processing/done/failed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 文档分块
export const chunks = pgTable('chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  docId: uuid('doc_id').references(() => documents.id),
  kbId: uuid('kb_id').references(() => knowledgeBases.id),
  content: text('content').notNull(),
  pageNum: integer('page_num'),
  sectionTitle: text('section_title'),
  chunkIndex: integer('chunk_index').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  keywords: text('keywords').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 对话
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  department: text('department').notNull(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 消息
export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  role: text('role').notNull(), // user/assistant
  content: text('content').notNull(),
  sources: jsonb('sources'), // [{chunkId, docName, page, section}]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 权限
export const kbPermissions = pgTable(
  'kb_permissions',
  {
    kbId: uuid('kb_id').notNull().references(() => knowledgeBases.id),
    department: text('department').notNull(),
    canRead: boolean('can_read').default(true),
    canWrite: boolean('can_write').default(false),
  },
  (table) => [primaryKey({ columns: [table.kbId, table.department] })]
);
