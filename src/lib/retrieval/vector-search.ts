import { db } from "@/lib/db";
import { chunks, kbPermissions } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/ingestion/embedder";
import { sql, eq, and, inArray } from "drizzle-orm";

const SIMILARITY_THRESHOLD = parseFloat(
  process.env.SIMILARITY_THRESHOLD || "0.7",
);
const TOP_K = 20;

export interface SearchResult {
  chunkId: string;
  content: string;
  docId: string;
  kbId: string;
  pageNum: number | null;
  sectionTitle: string | null;
  score: number;
  docName: string;
}

export async function vectorSearch(
  query: string,
  kbIds: string[],
  topK: number = TOP_K,
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);

  const results = await db.execute(sql`
    SELECT
      c.id as chunk_id,
      c.content,
      c.doc_id,
      c.kb_id,
      c.page_num,
      c.section_title,
      d.filename as doc_name,
      1 - (c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as score
    FROM chunks c
    JOIN documents d ON c.doc_id = d.id
    WHERE c.kb_id = ANY(ARRAY[${sql.join(
      kbIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[])
    AND 1 - (c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) > ${SIMILARITY_THRESHOLD}
    ORDER BY c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${topK}
  `);

  return (results as unknown as Record<string, unknown>[]).map((row) => ({
    chunkId: row.chunk_id as string,
    content: row.content as string,
    docId: row.doc_id as string,
    kbId: row.kb_id as string,
    pageNum: row.page_num as number | null,
    sectionTitle: row.section_title as string | null,
    score: row.score as number,
    docName: row.doc_name as string,
  }));
}

export async function keywordSearch(
  query: string,
  kbIds: string[],
  topK: number = TOP_K,
): Promise<SearchResult[]> {
  const { extractKeywords } = await import("@/lib/ingestion/embedder");
  const keywords = extractKeywords(query);

  if (keywords.length === 0) return [];

  const results = await db.execute(sql`
    SELECT
      c.id as chunk_id,
      c.content,
      c.doc_id,
      c.kb_id,
      c.page_num,
      c.section_title,
      d.filename as doc_name,
      ${0.5} as score
    FROM chunks c
    JOIN documents d ON c.doc_id = d.id
    WHERE c.kb_id = ANY(ARRAY[${sql.join(
      kbIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[])
    AND c.keywords && ARRAY[${sql.join(
      keywords.map((k) => sql`${k}`),
      sql`, `,
    )}]::text[]
    LIMIT ${topK}
  `);

  return (results as unknown as Record<string, unknown>[]).map((row) => ({
    chunkId: row.chunk_id as string,
    content: row.content as string,
    docId: row.doc_id as string,
    kbId: row.kb_id as string,
    pageNum: row.page_num as number | null,
    sectionTitle: row.section_title as string | null,
    score: row.score as number,
    docName: row.doc_name as string,
  }));
}

export async function getAccessibleKbIds(
  department: string,
): Promise<string[]> {
  const perms = await db
    .select({ kbId: kbPermissions.kbId })
    .from(kbPermissions)
    .where(
      and(
        eq(kbPermissions.department, department),
        eq(kbPermissions.canRead, true),
      ),
    );

  return perms.map((p) => p.kbId!);
}
