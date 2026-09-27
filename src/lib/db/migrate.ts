import { sql } from 'drizzle-orm';
import { db } from './index';

/**
 * 轻量索引自愈：结构变更以 drizzle/ 下的迁移文件为准（0001 已包含下列索引）。
 * 此函数仅在未执行迁移的环境（如本地旧库）兜底使用，全部幂等。
 */
export async function runMigrations() {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chunks_keywords_idx
    ON chunks USING gin (keywords);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS documents_kb_status_idx
    ON documents (kb_id, status);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chunks_kb_id_idx
    ON chunks (kb_id);
  `);

  console.log('Database indexes ensured');
}
