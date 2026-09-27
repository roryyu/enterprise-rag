import { db } from "@/lib/db";
import { chunks, kbPermissions } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/ingestion/embedder";
import { sql, eq, and, inArray } from "drizzle-orm";

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
  chunkIndex: number;
  // 排名信息：在各自搜索结果中的排名（从1开始）
  vectorRank?: number;
  keywordRank?: number;
  // 检索来源标识
  retrievalSource: "vector" | "keyword" | "both";
  // 混合检索分数
  hybridScore?: number;
  // 混合检索排名
  hybridRank?: number;
}

/**
 * 估算文本的 token 数量
 * 中文字符约 1.5 token，英文单词约 1 token
 */
export function estimateTokenCount(text: string): number {
  let tokenCount = 0;
  // 匹配中文字符
  const chineseChars = text.match(/[\u4e00-\u9fff]/g);
  if (chineseChars) {
    tokenCount += chineseChars.length * 1.5;
  }
  // 匹配英文单词（连续字母序列）
  const englishWords = text.match(/[a-zA-Z]+/g);
  if (englishWords) {
    tokenCount += englishWords.length;
  }
  // 数字序列
  const numbers = text.match(/\d+/g);
  if (numbers) {
    tokenCount += numbers.length;
  }
  return Math.ceil(tokenCount);
}

export async function vectorSearch(
  query: string,
  kbIds: string[],
  topK: number = TOP_K,
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);

  // 移除 SQL WHERE 中的相似度阈值过滤，返回 topK 结果交由融合层处理
  const results = await db.execute(sql`
    SELECT
      c.id as chunk_id,
      c.content,
      c.doc_id,
      c.kb_id,
      c.page_num,
      c.section_title,
      c.chunk_index,
      d.filename as doc_name,
      1 - (c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as score
    FROM chunks c
    JOIN documents d ON c.doc_id = d.id
    WHERE c.kb_id = ANY(ARRAY[${sql.join(
      kbIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[])
    ORDER BY c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${topK}
  `);

  return (results as unknown as Record<string, unknown>[]).map((row, index) => ({
    chunkId: row.chunk_id as string,
    content: row.content as string,
    docId: row.doc_id as string,
    kbId: row.kb_id as string,
    pageNum: row.page_num as number | null,
    sectionTitle: row.section_title as string | null,
    score: row.score as number,
    docName: row.doc_name as string,
    chunkIndex: row.chunk_index as number,
    vectorRank: index + 1,
    retrievalSource: "vector" as const,
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

  // 查询包含关键词重叠信息的搜索结果
  const results = await db.execute(sql`
    SELECT
      c.id as chunk_id,
      c.content,
      c.doc_id,
      c.kb_id,
      c.page_num,
      c.section_title,
      c.chunk_index,
      d.filename as doc_name,
      c.keywords as chunk_keywords
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

  const totalQueryKeywords = keywords.length;

  return (results as unknown as Record<string, unknown>[]).map((row, index) => {
    // 基于关键词重叠比率计算真实分数：匹配的关键词数 / 查询关键词总数，上限 0.8
    const chunkKeywords = (row.chunk_keywords as string[]) || [];
    const matchedCount = keywords.filter((k) => chunkKeywords.includes(k)).length;
    const overlapScore = totalQueryKeywords > 0 ? matchedCount / totalQueryKeywords : 0;
    const score = Math.min(overlapScore, 0.8);

    return {
      chunkId: row.chunk_id as string,
      content: row.content as string,
      docId: row.doc_id as string,
      kbId: row.kb_id as string,
      pageNum: row.page_num as number | null,
      sectionTitle: row.section_title as string | null,
      score,
      docName: row.doc_name as string,
      chunkIndex: row.chunk_index as number,
      keywordRank: index + 1,
      retrievalSource: "keyword" as const,
    };
  });
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
