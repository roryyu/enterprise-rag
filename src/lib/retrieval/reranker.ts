import { CohereClient } from "cohere-ai";
import { SearchResult } from "./vector-search";

// 每个文档最大输入字符数，超出截断
const MAX_INPUT_CHARS = 8000;
// 瞬时错误（429/5xx/网络/超时）最多重试 1 次；鉴权类永久错误不重试
const MAX_TRANSIENT_RETRIES = 1;
// 熔断冷却：连续失败后 60s 内直接本地排序，不再请求 Cohere；冷却后自动探测一次
const BREAKER_COOLDOWN_MS = 60_000;

let cohere: CohereClient | null = null;
function getCohere(): CohereClient {
  if (!cohere) {
    cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
  }
  return cohere;
}

/**
 * 熔断器状态（模块级单例）：
 * - openUntil > now：熔断中，静默走融合排序，不发任何请求
 * - 到期后放行一次探测：成功则恢复，失败则重新熔断
 */
const breaker = { openUntil: 0 };
// 只在“状态切换”时打一次日志，避免每次问答都刷控制台
let disabledLogged = false;
let openLogged = false;

export interface RerankResult {
  chunkId: string;
  content: string;
  docId: string;
  kbId: string;
  pageNum: number | null;
  sectionTitle: string | null;
  docName: string;
  score: number;
  rerankFallback: boolean;
}

/**
 * 截断文本到最大字符数
 */
function truncateToMaxLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

/**
 * 回退排序：按 fusedScore 降序排列，取 topN（纯函数，不打日志）
 */
function fallbackSort(results: SearchResult[], topN: number): RerankResult[] {
  return results
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topN)
    .map((r) => ({
      chunkId: r.chunkId,
      content: r.content,
      docId: r.docId,
      kbId: r.kbId,
      pageNum: r.pageNum,
      sectionTitle: r.sectionTitle,
      docName: r.docName,
      score: r.score,
      rerankFallback: true,
    }));
}

/**
 * 从 SDK 错误中尽力提取 HTTP 状态码
 */
function getStatusCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const code = (error as { statusCode?: number; status?: number }).statusCode
      ?? (error as { status?: number }).status;
    if (typeof code === "number") return code;
  }
  return null;
}

/**
 * 永久性错误：密钥无效/被禁/模型不存在，重试没有意义
 */
function isPermanentError(error: unknown): boolean {
  const status = getStatusCode(error);
  return status !== null && [401, 403, 404].includes(status);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Cohere rerank 调用：仅对瞬时错误做有限次退避重试
 */
async function cohereRerankWithRetry(
  query: string,
  documents: string[],
  topN: number,
): Promise<{ index: number; relevanceScore: number }[]> {
  const client = getCohere();
  let attempt = 0;

  for (;;) {
    try {
      const response = await client.v2.rerank({
        model: "rerank-v3.5",
        query,
        documents,
        topN: Math.min(topN, documents.length),
      });

      return response.results.map(
        (item: { index: number; relevanceScore: number }) => ({
          index: item.index,
          relevanceScore: item.relevanceScore,
        }),
      );
    } catch (error) {
      if (isPermanentError(error) || attempt >= MAX_TRANSIENT_RETRIES) {
        throw error;
      }
      attempt += 1;
      console.warn(
        `[reranker] Cohere 瞬时错误（${getStatusCode(error) ?? "network"}），1s 后进行第 ${attempt} 次重试`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Rerank 入口：
 * 未配置/未启用 → 仅提示一次后本地排序；
 * 服务不可用 → 熔断期内静默本地排序，冷却后自动探测恢复。
 */
export async function rerank(
  query: string,
  results: SearchResult[],
  topN: number = 5,
): Promise<RerankResult[]> {
  if (results.length === 0) return [];

  if (!process.env.COHERE_API_KEY || process.env.COHERE_RERANK_ENABLED !== "true") {
    if (!disabledLogged) {
      const hint = !process.env.COHERE_API_KEY
        ? "未配置 COHERE_API_KEY"
        : "未设置 COHERE_RERANK_ENABLED=true";
      console.info(`[reranker] ${hint}，Rerank 关闭，使用融合分数排序（仅提示一次）`);
      disabledLogged = true;
    }
    return fallbackSort(results, topN);
  }

  // 熔断中：静默降级，不发请求
  if (Date.now() < breaker.openUntil) {
    return fallbackSort(results, topN);
  }

  const documents = results.map((r) =>
    truncateToMaxLength(r.content, MAX_INPUT_CHARS),
  );

  try {
    const rerankResults = await cohereRerankWithRetry(query, documents, topN);

    // 探测成功：若之前处于熔断，记录一次恢复
    if (openLogged) {
      console.info("[reranker] Cohere 服务已恢复，重新启用 Rerank");
      openLogged = false;
    }

    return rerankResults.map((item) => {
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
        rerankFallback: false,
      };
    });
  } catch (error) {
    // 打开熔断；仅在“可用 → 不可用”切换时打一次日志
    breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    if (!openLogged) {
      const status = getStatusCode(error);
      console.warn(
        `[reranker] Cohere Rerank 不可用（${status ?? "网络错误"}: ${errorMessage(error)}），熔断 ${BREAKER_COOLDOWN_MS / 1000}s，期间静默使用融合分数排序；冷却后自动重试`,
      );
      openLogged = true;
    }
    return fallbackSort(results, topN);
  }
}
