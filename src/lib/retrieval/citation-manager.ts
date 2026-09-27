import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { sql, eq, and, inArray } from "drizzle-orm";

/**
 * 引用ID生成器
 */
export class CitationIdGenerator {
  /**
   * 生成稳定的引用ID
   */
  static generateCitationId(chunkId: string): string {
    // 使用chunkId的哈希生成简短的ID
    const hash = this.simpleHash(chunkId);
    return `S${hash}`;
  }
  
  /**
   * 简单哈希函数
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36).slice(0, 4).toUpperCase();
  }
  
  /**
   * 批量生成引用ID
   */
  static generateCitationIds(chunkIds: string[]): string[] {
    return chunkIds.map(chunkId => this.generateCitationId(chunkId));
  }
}

/**
 * 引用校验器
 */
export class CitationValidator {
  /**
   * 校验引用ID的有效性
   */
  static async validateCitationIds(citationIds: string[]): Promise<{
    valid: string[];
    invalid: string[];
    details: Record<string, any>;
  }> {
    const valid: string[] = [];
    const invalid: string[] = [];
    const details: Record<string, any> = {};
    
    if (citationIds.length === 0) {
      return { valid, invalid, details };
    }
    
    // 查询对应的chunk信息
    const chunkIds = citationIds.map(id => id.slice(1)); // 去掉'S'前缀
    const chunkResults = await db.query.chunks.findMany({
      where: inArray(chunks.id, chunkIds),
      with: { document: true },
    });
    
    // 创建chunkId到chunk的映射
    const chunkMap = new Map<string, any>();
    chunkResults.forEach(chunk => {
      chunkMap.set(chunk.id, chunk);
    });
    
    // 校验每个引用ID
    for (const citationId of citationIds) {
      const chunkId = citationId.slice(1); // 去掉'S'前缀
      
      if (!chunkMap.has(chunkId)) {
        invalid.push(citationId);
        details[citationId] = { error: "Chunk not found", chunkId };
        continue;
      }
      
      const chunk = chunkMap.get(chunkId);
      
      // 检查chunk是否有效
      if (chunk.document?.status !== "done") {
        invalid.push(citationId);
        details[citationId] = { error: "Document not ready", status: chunk.document?.status };
        continue;
      }
      
      // 检查内容是否为空
      if (!chunk.content || chunk.content.trim().length === 0) {
        invalid.push(citationId);
        details[citationId] = { error: "Empty content" };
        continue;
      }
      
      valid.push(citationId);
      details[citationId] = {
        chunkId,
        docId: chunk.docId,
        docName: chunk.document?.filename,
        pageNum: chunk.pageNum,
        sectionTitle: chunk.sectionTitle,
        content: chunk.content.substring(0, 100) + "...", // 截取前100字符
      };
    }
    
    return { valid, invalid, details };
  }
  
  /**
   * 校验引用文本是否支持答案
   */
  static async validateCitationSupport(
    answer: string,
    citationIds: string[],
    context: string[]
  ): Promise<{
    supported: string[];
    unsupported: string[];
    details: Record<string, any>;
  }> {
    const supported: string[] = [];
    const unsupported: string[] = [];
    const details: Record<string, any> = {};
    
    if (citationIds.length === 0) {
      return { supported, unsupported, details };
    }
    
    // 获取chunk详细信息
    const chunkIds = citationIds.map(id => id.slice(1));
    const chunkResults = await db.query.chunks.findMany({
      where: inArray(chunks.id, chunkIds),
    });
    
    const chunkMap = new Map<string, any>();
    chunkResults.forEach(chunk => {
      chunkMap.set(chunk.id, chunk);
    });
    
    // 检查每个引用是否支持答案
    for (const citationId of citationIds) {
      const chunkId = citationId.slice(1);
      const chunk = chunkMap.get(chunkId);
      
      if (!chunk) {
        unsupported.push(citationId);
        details[citationId] = { error: "Chunk not found" };
        continue;
      }
      
      // 检查答案中的关键信息是否在引用中
      const answerKeywords = this.extractAnswerKeywords(answer);
      const citationKeywords = this.extractAnswerKeywords(chunk.content);
      
      const hasOverlap = answerKeywords.some(keyword => 
        citationKeywords.some(citationKeyword => 
          citationKeyword.includes(keyword) || keyword.includes(citationKeyword)
        )
      );
      
      if (hasOverlap) {
        supported.push(citationId);
        details[citationId] = {
          overlapKeywords: answerKeywords.filter(keyword =>
            citationKeywords.some(citationKeyword =>
              citationKeyword.includes(keyword) || keyword.includes(citationKeyword)
            )
          ),
          confidence: this.calculateSupportConfidence(answer, chunk.content),
        };
      } else {
        unsupported.push(citationId);
        details[citationId] = {
          error: "No keyword overlap",
          answerKeywords,
          citationKeywords,
        };
      }
    }
    
    return { supported, unsupported, details };
  }
  
  /**
   * 提取答案关键词
   */
  private static extractAnswerKeywords(answer: string): string[] {
    // 提取名词和关键信息
    const words = answer.match(/[\u4e00-\u9fff]+|[a-zA-Z]+/g) || [];
    const stopWords = [
      "的", "了", "和", "与", "或", "但", "是", "在", "有", "我", "你", "他", "它", "这", "那",
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"
    ];
    
    return words
      .filter(word => word.length > 2 && !stopWords.includes(word.toLowerCase()))
      .slice(0, 10); // 限制关键词数量
  }
  
  /**
   * 计算支持置信度
   */
  private static calculateSupportConfidence(answer: string, citation: string): number {
    const answerWords = this.extractAnswerKeywords(answer);
    const citationWords = this.extractAnswerKeywords(citation);
    
    if (answerWords.length === 0) return 0;
    
    let matchedCount = 0;
    for (const answerWord of answerWords) {
      if (citationWords.some(citationWord => 
        citationWord.includes(answerWord) || answerWord.includes(citationWord)
      )) {
        matchedCount++;
      }
    }
    
    return matchedCount / answerWords.length;
  }
}

/**
 * 引用管理器
 */
export class CitationManager {
  /**
   * 生成结构化答案
   */
  static async generateStructuredAnswer(
    answer: string,
    citations: Array<{
      chunkId: string;
      content: string;
      docName: string;
      pageNum?: number;
      sectionTitle?: string;
    }>
  ): Promise<{
    answer: string;
    citations: Array<{
      text: string;
      sourceIds: string[];
      docName: string;
      pageNum?: number;
      sectionTitle?: string;
    }>;
    confidence: string;
  }> {
    // 生成引用ID
    const citationIds = CitationIdGenerator.generateCitationIds(citations.map(c => c.chunkId));
    
    // 构建引用信息
    const structuredCitations = citations.map((citation, index) => ({
      text: citation.content,
      sourceIds: [citationIds[index]!],
      docName: citation.docName,
      pageNum: citation.pageNum,
      sectionTitle: citation.sectionTitle,
    }));
    
    // 计算置信度
    const confidence = this.calculateAnswerConfidence(answer, structuredCitations);
    
    return {
      answer,
      citations: structuredCitations,
      confidence,
    };
  }
  
  /**
   * 计算答案置信度
   */
  private static calculateAnswerConfidence(
    answer: string,
    citations: Array<{
      text: string;
      sourceIds: string[];
    }>
  ): string {
    if (citations.length === 0) return "none";
    
    // 检查答案长度
    const answerLength = answer.length;
    if (answerLength < 10) return "low";
    
    // 检查引用数量
    const citationCount = citations.length;
    if (citationCount === 0) return "none";
    if (citationCount >= 3) return "high";
    
    // 检查引用质量
    const totalCitationLength = citations.reduce((sum, citation) => sum + citation.text.length, 0);
    const citationRatio = totalCitationLength / answerLength;
    
    if (citationRatio > 2) return "high";
    if (citationRatio > 1) return "medium";
    
    return "medium";
  }
  
  /**
   * 生成引用HTML
   */
  static generateCitationHTML(citations: Array<{
    text: string;
    sourceIds: string[];
    docName: string;
    pageNum?: number;
    sectionTitle?: number;
  }>): string {
    return citations.map(citation => {
      const sourceText = citation.sourceIds.join(", ");
      const locationText = citation.pageNum 
        ? `第${citation.pageNum}页`
        : citation.sectionTitle 
        ? citation.sectionTitle
        : citation.docName;
      
      return `<cite class="citation" data-source-id="${citation.sourceIds.join(",")}">
        <span class="citation-text">${citation.text}</span>
        <span class="citation-source">[${sourceText}] ${locationText}</span>
      </cite>`;
    }).join("");
  }
}

/**
 * 拒答策略管理器
 */
export class RefusalManager {
  /**
   * 判断是否应该拒答
   */
  static shouldRefuseAnswer(
    query: string,
    searchResults: any[],
    answer?: string
  ): {
    shouldRefuse: boolean;
    reason: string;
    suggestion?: string;
  } {
    // 检查是否有相关结果
    if (searchResults.length === 0) {
      return {
        shouldRefuse: true,
        reason: "no_relevant_sources",
        suggestion: "抱歉，我没有找到与您查询相关的信息。请尝试使用更具体的关键词或检查查询内容。"
      };
    }
    
    // 检查检索置信度
    const avgConfidence = searchResults.reduce((sum, result) => sum + (result.score || 0), 0) / searchResults.length;
    if (avgConfidence < 0.3) {
      return {
        shouldRefuse: true,
        reason: "low_confidence",
        suggestion: "抱歉，我没有找到足够可靠的信息来回答您的问题。请尝试其他查询方式。"
      };
    }
    
    // 检查是否为计算查询
    const calculationKeywords = ["计算", "统计", "总和", "平均", "百分比", "比例", "增长", "减少", "变化"];
    if (calculationKeywords.some(keyword => query.includes(keyword))) {
      return {
        shouldRefuse: true,
        reason: "calculation_required",
        suggestion: "这个问题需要计算，建议使用专门的计算工具或咨询相关专家。"
      };
    }
    
    // 检查是否为外部知识查询
    const externalKeywords = ["互联网", "网络", "搜索", "百度", "谷歌", "最新", "当前", "现在"];
    if (externalKeywords.some(keyword => query.includes(keyword))) {
      return {
        shouldRefuse: true,
        reason: "external_knowledge",
        suggestion: "抱歉，我无法访问外部互联网信息。我的知识仅限于企业内部文档。"
      };
    }
    
    // 检查答案是否包含不确定表述
    if (answer && this.containsUncertainExpressions(answer)) {
      return {
        shouldRefuse: true,
        reason: "uncertain_answer",
        suggestion: "抱歉，我无法确定这个问题的答案。请提供更具体的查询或咨询相关部门。"
      };
    }
    
    return {
      shouldRefuse: false,
      reason: "none"
    };
  }
  
  /**
   * 检查是否包含不确定表述
   */
  private static containsUncertainExpressions(answer: string): boolean {
    const uncertainPatterns = [
      /可能|大概|或许|也许|差不多|应该|估计|大概|约|左右/,
      /I think|maybe|perhaps|probably|approximately|around/,
      /不确定|不清楚|不知道|没找到|没找到相关/
    ];
    
    return uncertainPatterns.some(pattern => pattern.test(answer));
  }
  
  /**
   * 生成拒答消息
   */
  static generateRefusalMessage(reason: string, suggestion?: string): string {
    const refusalMessages = {
      no_relevant_sources: "抱歉，我没有找到与您查询相关的信息。",
      low_confidence: "抱歉，我没有找到足够可靠的信息来回答您的问题。",
      calculation_required: "这个问题需要计算，建议使用专门的计算工具或咨询相关专家。",
      external_knowledge: "抱歉，我无法访问外部互联网信息。我的知识仅限于企业内部文档。",
      uncertain_answer: "抱歉，我无法确定这个问题的答案。",
    };
    
    const baseMessage = refusalMessages[reason as keyof typeof refusalMessages] || "抱歉，我无法回答这个问题。";
    
    return suggestion 
      ? `${baseMessage} ${suggestion}`
      : baseMessage;
  }
}

/**
 * 引用统计管理器
 */
export class CitationStats {
  /**
   * 记录引用统计
   */
  static async recordCitationStats(
    conversationId: string,
    citations: Array<{
      text: string;
      sourceIds: string[];
      docName: string;
      pageNum?: number;
      sectionTitle?: string;
    }>,
    answer: string
  ): Promise<void> {
    try {
      // 这里可以扩展为数据库记录
      console.log(`[CitationStats] Recording stats for conversation ${conversationId}`, {
        citationCount: citations.length,
        totalCitationLength: citations.reduce((sum, citation) => sum + citation.text.length, 0),
        answerLength: answer.length,
        hasPageNumbers: citations.some(c => c.pageNum !== undefined),
        hasSectionTitles: citations.some(c => c.sectionTitle !== undefined),
      });
    } catch (error) {
      console.error("[CitationStats] Failed to record stats:", error);
    }
  }
  
  /**
   * 计算引用完整率
   */
  static calculateCitationCompleteness(
    answer: string,
    citations: Array<{
      text: string;
      sourceIds: string[];
    }>
  ): number {
    if (citations.length === 0) return 0;
    
    const answerKeywords = this.extractAnswerKeywords(answer);
    const totalKeywords = answerKeywords.length;
    
    if (totalKeywords === 0) return 0;
    
    let matchedKeywords = 0;
    for (const keyword of answerKeywords) {
      const isCovered = citations.some(citation => 
        citation.text.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isCovered) {
        matchedKeywords++;
      }
    }
    
    return matchedKeywords / totalKeywords;
  }

  /**
   * 从答案中提取关键词（英文单词 + 中文二字滑窗），用于引用完整率计算
   */
  private static extractAnswerKeywords(answer: string): string[] {
    const keywords: string[] = [];

    // 英文/数字词
    const wordMatches = answer.match(/[A-Za-z0-9][A-Za-z0-9_-]{1,}/g);
    if (wordMatches) {
      keywords.push(...wordMatches);
    }

    // 中文连续片段的二字滑窗
    const cjkSegments = answer.match(/[\u4e00-\u9fff]+/g);
    if (cjkSegments) {
      for (const segment of cjkSegments) {
        for (let i = 0; i < segment.length - 1; i++) {
          keywords.push(segment.slice(i, i + 2));
        }
      }
    }

    return [...new Set(keywords)];
  }
}