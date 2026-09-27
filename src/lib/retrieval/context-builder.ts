import { RerankResult } from "./reranker";
import { estimateTokenCount } from "./vector-search";

export interface SourceMapping {
  sourceId: string;      // "S1", "S2" 等
  chunkId: string;
  docName: string;
  pageNum: number | null;
  sectionTitle: string | null;
  content: string;
}

export interface BuiltContext {
  contextText: string;       // LLM 使用的完整上下文块
  sourceMappings: SourceMapping[];
  totalTokens: number;
  truncated: boolean;        // 是否因 token 预算不足而丢弃了部分结果
}

/**
 * 从重排结果构建 LLM 上下文字符串
 * 管理 token 预算、分配来源 ID（[S1], [S2] 等）、组装上下文及元数据
 */
export function buildContext(
  results: RerankResult[],
  maxTokens: number = 3000,
): BuiltContext {
  const sourceMappings: SourceMapping[] = [];
  const contextParts: string[] = [];
  let totalTokens = 0;
  let truncated = false;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const sourceId = `S${i + 1}`;
    const tokenCount = estimateTokenCount(result.content);

    // 检查 token 预算
    if (totalTokens + tokenCount > maxTokens) {
      truncated = true;
      break;
    }

    // 构建来源映射
    sourceMappings.push({
      sourceId,
      chunkId: result.chunkId,
      docName: result.docName,
      pageNum: result.pageNum,
      sectionTitle: result.sectionTitle,
      content: result.content,
    });

    // 构建上下文片段，包含来源标识和元数据
    const metadataParts: string[] = [];
    metadataParts.push(`来源: ${result.docName}`);
    if (result.pageNum !== null) {
      metadataParts.push(`第${result.pageNum}页`);
    }
    if (result.sectionTitle !== null) {
      metadataParts.push(`章节: ${result.sectionTitle}`);
    }

    const contextBlock = `[${sourceId}] ${metadataParts.join(" | ")}\n${result.content}`;
    contextParts.push(contextBlock);
    totalTokens += tokenCount;
  }

  const contextText = contextParts.length > 0
    ? contextParts.join("\n\n---\n\n")
    : "";

  return {
    contextText,
    sourceMappings,
    totalTokens,
    truncated,
  };
}
