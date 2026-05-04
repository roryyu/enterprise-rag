import { sql } from 'drizzle-orm';
import { db } from './index';

export async function runMigrations() {
  // Create HNSW index for vector similarity search
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx 
    ON chunks USING hnsw (embedding vector_cosine_ops);
  `);

  // Create GIN index for keyword array search
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chunks_keywords_idx 
    ON chunks USING gin (keywords);
  `);

  // Create index for document lookups by knowledge base
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS documents_kb_id_idx 
    ON documents (kb_id);
  `);

  // Create index for chunk lookups by knowledge base
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chunks_kb_id_idx 
    ON chunks (kb_id);
  `);

  console.log('Database indexes created successfully');
}
