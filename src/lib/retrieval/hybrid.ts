import { vectorSearch, keywordSearch, getAccessibleKbIds, SearchResult, estimateTokenCount } from './vector-search';
import { rerank, RerankResult } from './reranker';
import { db } from "@/lib/db";
import { chunks } from "@/lib/db/schema";
import { sql, eq, and } from "drizzle-orm";

export interface HybridSearchConfig {
  vectorWeight?: number;        // 向量搜索权重，默认 0.7
  keywordWeight?: number;       // 关键词搜索权重，默认 0.3
  rrfK?: number;                // RRF 常数 K，默认 60
  topK?: number;                // 候选池大小，默认 30
  finalTopN?: number;           // 重排后最终结果数，默认 5
  maxChunksPerDoc?: number;     // 单文档最大分块数，默认 3
  dynamicThresholdRatio?: number; // 动态阈值比例，默认 0.5
  minResults?: number;          // 最少保留结果数，默认 3
  maxContextTokens?: number;    // 最大上下文 token 数，默认 3000
  enableAdjacentExpansion?: boolean; // 是否启用相邻块扩展，默认 true
}

export interface FusedSearchResult extends SearchResult {
  fusedScore: number;
}

export interface HybridSearchResult extends RerankResult {}

/**
 * 递归倒数排名融合（Reciprocal Rank Fusion）
 * 对同一 chunkId，向量搜索和关键词搜索都命中的会累加两个 RRF 贡献
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  config: Required<HybridSearchConfig>,
): FusedSearchResult[] {
  const { vectorWeight, keywordWeight, rrfK } = config;
  const fusedMap = new Map<string, FusedSearchResult>();

  // 处理向量搜索结果
  for (const r of vectorResults) {
    const rrfScore = vectorWeight / (rrfK + (r.vectorRank ?? 1));
    const existing = fusedMap.get(r.chunkId);
    if (existing) {
      existing.fusedScore += rrfScore;
      existing.vectorRank = r.vectorRank;
      existing.retrievalSource = "both";
      // 保留更高的原始分数
      if (r.score > existing.score) {
        existing.score = r.score;
      }
    } else {
      fusedMap.set(r.chunkId, {
        ...r,
        fusedScore: rrfScore,
        retrievalSource: r.retrievalSource,
      });
    }
  }

  // 处理关键词搜索结果
  for (const r of keywordResults) {
    const rrfScore = keywordWeight / (rrfK + (r.keywordRank ?? 1));
    const existing = fusedMap.get(r.chunkId);
    if (existing) {
      existing.fusedScore += rrfScore;
      existing.keywordRank = r.keywordRank;
      existing.retrievalSource = "both";
      // 保留更高的原始分数
      if (r.score > existing.score) {
        existing.score = r.score;
      }
    } else {
      fusedMap.set(r.chunkId, {
        ...r,
        fusedScore: rrfScore,
        retrievalSource: r.retrievalSource,
      });
    }
  }

  // 按 fusedScore 降序排列
  return Array.from(fusedMap.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * 动态阈值过滤：过滤掉融合分数低于 topScore * ratio 的结果，但至少保留 minResults 个
 */
function applyDynamicThreshold(
  results: FusedSearchResult[],
  ratio: number,
  minResults: number,
): FusedSearchResult[] {
  if (results.length === 0) return [];

  const topScore = results[0]!.fusedScore;
  const threshold = topScore * ratio;

  // 找到满足阈值条件的结果
  const aboveThreshold = results.filter((r) => r.fusedScore >= threshold);

  // 至少保留 minResults 个
  return aboveThreshold.length >= minResults
    ? aboveThreshold
    : results.slice(0, minResults);
}

/**
 * 文档多样性：限制单文档最大分块数，确保不单一文档占主导
 */
function applyDocDiversity(
  results: FusedSearchResult[],
  maxChunksPerDoc: number,
): FusedSearchResult[] {
  const docCountMap = new Map<string, number>();
  const filtered: FusedSearchResult[] = [];

  for (const r of results) {
    const count = docCountMap.get(r.docId) ?? 0;
    if (count < maxChunksPerDoc) {
      filtered.push(r);
      docCountMap.set(r.docId, count + 1);
    }
  }

  return filtered;
}

/**
 * 相邻块扩展：对已选中的分块，查找其在同一文档中的相邻分块（chunkIndex ± 1）
 * 在 token 预算内补充相邻块
 */
async function expandAdjacentChunks(
  results: FusedSearchResult[],
  maxContextTokens: number,
): Promise<FusedSearchResult[]> {
  // 收集需要查找相邻块的信息
  const neighborQueries: { docId: string; chunkIndex: number; originalChunkId: string }[] = [];
  const existingChunkIds = new Set(results.map((r) => r.chunkId));

  for (const r of results) {
    neighborQueries.push({
      docId: r.docId,
      chunkIndex: r.chunkIndex - 1,
      originalChunkId: r.chunkId,
    });
    neighborQueries.push({
      docId: r.docId,
      chunkIndex: r.chunkIndex + 1,
      originalChunkId: r.chunkId,
    });
  }

  if (neighborQueries.length === 0) return results;

  // 批量查询相邻块
  const expandedResults: FusedSearchResult[] = [...results];
  let currentTokens = results.reduce((sum, r) => sum + estimateTokenCount(r.content), 0);

  // 按文档分组查询相邻块，减少查询次数
  const docGroups = new Map<string, Set<number>>();
  for (const q of neighborQueries) {
    if (!docGroups.has(q.docId)) {
      docGroups.set(q.docId, new Set());
    }
    docGroups.get(q.docId)!.add(q.chunkIndex);
  }

  for (const [docId, indices] of docGroups) {
    if (currentTokens >= maxContextTokens) break;

    const indexArray = Array.from(indices);
    // 查询该文档中指定 chunkIndex 的分块
    const neighborChunks = await db.execute(sql`
      SELECT
        c.id as chunk_id,
        c.content,
        c.doc_id,
        c.kb_id,
        c.page_num,
        c.section_title,
        c.chunk_index,
        d.filename as doc_name
      FROM chunks c
      JOIN documents d ON c.doc_id = d.id
      WHERE c.doc_id = ${docId}
      AND c.chunk_index = ANY(ARRAY[${sql.join(
        indexArray.map((i) => sql`${i}`),
        sql`, `,
      )}]::integer[])
    `);

    for (const row of neighborChunks as unknown as Record<string, unknown>[]) {
      const chunkId = row.chunk_id as string;
      // 跳过已存在的分块
      if (existingChunkIds.has(chunkId)) continue;

      const content = row.content as string;
      const tokens = estimateTokenCount(content);
      if (currentTokens + tokens > maxContextTokens) continue;

      existingChunkIds.add(chunkId);
      currentTokens += tokens;

      expandedResults.push({
        chunkId,
        content,
        docId: row.doc_id as string,
        kbId: row.kb_id as string,
        pageNum: row.page_num as number | null,
        sectionTitle: row.section_title as string | null,
        score: 0, // 扩展的相邻块原始分数为0，由主块的融合分数决定
        docName: row.doc_name as string,
        chunkIndex: row.chunk_index as number,
        fusedScore: 0, // 相邻扩展块不参与融合排序
        retrievalSource: "both",
      });
    }
  }

  return expandedResults;
}

export async function hybridSearch(
  query: string,
  department: string,
  config: HybridSearchConfig = {},
): Promise<{ results: HybridSearchResult[]; kbIds: string[] }> {
  // 合并配置与默认值
  const fullConfig: Required<HybridSearchConfig> = {
    vectorWeight: config.vectorWeight ?? 0.7,
    keywordWeight: config.keywordWeight ?? 0.3,
    rrfK: config.rrfK ?? 60,
    topK: config.topK ?? 30,
    finalTopN: config.finalTopN ?? 5,
    maxChunksPerDoc: config.maxChunksPerDoc ?? 3,
    dynamicThresholdRatio: config.dynamicThresholdRatio ?? 0.5,
    minResults: config.minResults ?? 3,
    maxContextTokens: config.maxContextTokens ?? 3000,
    enableAdjacentExpansion: config.enableAdjacentExpansion ?? true,
  };

  const kbIds = await getAccessibleKbIds(department);

  if (kbIds.length === 0) {
    return { results: [], kbIds: [] };
  }

  // 并行执行向量搜索和关键词搜索
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(query, kbIds, fullConfig.topK),
    keywordSearch(query, kbIds, fullConfig.topK),
  ]);

  // RRF 融合
  const fused = reciprocalRankFusion(vectorResults, keywordResults, fullConfig);

  // 动态阈值过滤
  const thresholdFiltered = applyDynamicThreshold(
    fused,
    fullConfig.dynamicThresholdRatio,
    fullConfig.minResults,
  );

  // 文档多样性过滤
  const diversityFiltered = applyDocDiversity(
    thresholdFiltered,
    fullConfig.maxChunksPerDoc,
  );

  // 相邻块扩展
  let expanded: FusedSearchResult[];
  if (fullConfig.enableAdjacentExpansion) {
    expanded = await expandAdjacentChunks(
      diversityFiltered,
      fullConfig.maxContextTokens,
    );
  } else {
    expanded = diversityFiltered;
  }

  // 重排
  const reranked = await rerank(query, expanded, fullConfig.finalTopN);

  return { results: reranked, kbIds };
}
