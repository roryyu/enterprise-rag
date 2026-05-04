import { vectorSearch, keywordSearch, getAccessibleKbIds, SearchResult } from './vector-search';
import { rerank, RerankResult } from './reranker';

export interface HybridSearchResult extends RerankResult {}

export async function hybridSearch(
  query: string,
  department: string,
  topN: number = 5
): Promise<{ results: HybridSearchResult[]; kbIds: string[] }> {
  const kbIds = await getAccessibleKbIds(department);

  if (kbIds.length === 0) {
    return { results: [], kbIds: [] };
  }

  // Parallel: vector + keyword search
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(query, kbIds),
    keywordSearch(query, kbIds),
  ]);

  // Merge & deduplicate by chunkId
  const mergedMap = new Map<string, SearchResult>();
  for (const r of vectorResults) {
    mergedMap.set(r.chunkId, r);
  }
  for (const r of keywordResults) {
    if (!mergedMap.has(r.chunkId)) {
      mergedMap.set(r.chunkId, r);
    }
  }

  const merged = Array.from(mergedMap.values());

  // Rerank
  const reranked = await rerank(query, merged, topN);

  return { results: reranked, kbIds };
}
