import { CohereClient } from 'cohere-ai';
import { SearchResult } from './vector-search';

let cohere: CohereClient | null = null;
function getCohere(): CohereClient {
  if (!cohere) {
    cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
  }
  return cohere;
}

export interface RerankResult {
  chunkId: string;
  content: string;
  docId: string;
  kbId: string;
  pageNum: number | null;
  sectionTitle: string | null;
  docName: string;
  score: number;
}

export async function rerank(
  query: string,
  results: SearchResult[],
  topN: number = 5
): Promise<RerankResult[]> {
  if (results.length === 0) return [];

  try {
    const response = await getCohere().v2.rerank({
      model: 'rerank-v3.5',
      query,
      documents: results.map((r) => r.content),
      topN: Math.min(topN, results.length),
    });

    return response.results.map((item) => {
      const source = results[item.index]!;
      return {
        chunkId: source.chunkId,
        content: source.content,
        docId: source.docId,
        kbId: source.kbId,
        pageNum: source.pageNum,
        sectionTitle: source.sectionTitle,
        docName: source.docName,
        score: item.relevanceScore,
      };
    });
  } catch (error) {
    console.error('Rerank failed, falling back to vector scores:', error);
    // Fallback: use original scores
    return results.slice(0, topN).map((r) => ({ ...r }));
  }
}
