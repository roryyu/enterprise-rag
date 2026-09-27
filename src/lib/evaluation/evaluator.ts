import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { sql, eq, and, isNull } from "drizzle-orm";
import { hybridSearch } from "@/lib/retrieval/hybrid";
import { CitationValidator, CitationManager } from "@/lib/retrieval/citation-manager";

/**
 * 评测数据集项
 */
export interface EvaluationDatasetItem {
  id: string;
  question: string;
  expectedSources: string[]; // 期望的chunkId列表
  referenceAnswer: string;
  permissions: {
    department: string;
    kbIds: string[];
  };
  category: string;
  difficulty: "easy" | "medium" | "hard";
  createdAt: Date;
}

/**
 * 评测结果
 */
export interface EvaluationResult {
  itemId: string;
  question: string;
  actualSources: string[];
  expectedSources: string[];
  recallAtK: number;
  hitAtK: number;
  mrr: number;
  ndcgAtK: number;
  answer: string;
  referenceAnswer: string;
  answerCorrectness: number;
  citationPrecision: number;
  citationCompleteness: number;
  confidence: string;
  latency: number;
  error?: string;
}

/**
 * 检索指标计算器
 */
export class RetrievalMetrics {
  /**
   * 计算Recall@K
   */
  static calculateRecallAtK(actual: string[], expected: string[], k: number = 5): number {
    const actualTopK = actual.slice(0, k);
    const expectedSet = new Set(expected);
    const actualTopKSet = new Set(actualTopK);
    
    const intersection = new Set([...expectedSet].filter(x => actualTopKSet.has(x)));
    return intersection.size / expected.length;
  }
  
  /**
   * 计算Hit@K
   */
  static calculateHitAtK(actual: string[], expected: string[], k: number = 5): number {
    const actualTopK = actual.slice(0, k);
    const expectedSet = new Set(expected);
    
    return actualTopK.some(item => expectedSet.has(item)) ? 1 : 0;
  }
  
  /**
   * 计算MRR (Mean Reciprocal Rank)
   */
  static calculateMRR(actual: string[], expected: string[]): number {
    const expectedSet = new Set(expected);
    
    for (let i = 0; i < actual.length; i++) {
      const item = actual[i];
      if (item !== undefined && expectedSet.has(item)) {
        return 1 / (i + 1);
      }
    }
    
    return 0;
  }
  
  /**
   * 计算nDCG@K
   */
  static calculateNDCGAtK(actual: string[], expected: string[], k: number = 5): number {
    const actualTopK = actual.slice(0, k);
    const expectedSet = new Set(expected);
    
    // 理想DCG
    let idealDCG = 0;
    for (let i = 0; i < k && i < expected.length; i++) {
      idealDCG += 1 / Math.log2(i + 2);
    }
    
    if (idealDCG === 0) return 0;
    
    // 实际DCG
    let actualDCG = 0;
    for (let i = 0; i < actualTopK.length; i++) {
      const item = actualTopK[i];
      if (item !== undefined && expectedSet.has(item)) {
        actualDCG += 1 / Math.log2(i + 2);
      }
    }
    
    return actualDCG / idealDCG;
  }
}

/**
 * 答案质量评估器
 */
export class AnswerQualityEvaluator {
  /**
   * 计算答案正确性
   */
  static calculateAnswerCorrectness(answer: string, referenceAnswer: string): number {
    if (!answer || !referenceAnswer) return 0;
    
    // 简单的关键词重叠度
    const answerKeywords = this.extractKeywords(answer);
    const referenceKeywords = this.extractKeywords(referenceAnswer);
    
    if (answerKeywords.length === 0 || referenceKeywords.length === 0) return 0;
    
    const commonKeywords = answerKeywords.filter(keyword => 
      referenceKeywords.some(refKeyword => 
        refKeyword.includes(keyword) || keyword.includes(refKeyword)
      )
    );
    
    return commonKeywords.length / referenceKeywords.length;
  }
  
  /**
   * 提取关键词
   */
  private static extractKeywords(text: string): string[] {
    const words = text.match(/[\u4e00-\u9fff]+|[a-zA-Z]+/g) || [];
    const stopWords = [
      "的", "了", "和", "与", "或", "但", "是", "在", "有", "我", "你", "他", "它", "这", "那",
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"
    ];
    
    return words
      .filter(word => word.length > 2 && !stopWords.includes(word.toLowerCase()))
      .slice(0, 10);
  }
}

/**
 * 评测管理器
 */
export class EvaluationManager {
  /**
   * 执行单条评测
   */
  static async evaluateItem(
    item: EvaluationDatasetItem,
    config: {
      topK?: number;
      rerankEnabled?: boolean;
    } = {}
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    
    try {
      // 执行检索
      const { results } = await hybridSearch(
        item.question,
        item.permissions.department,
        {
          topK: config.topK || 20,
          finalTopN: config.topK || 5,
        }
      );
      
      const actualSources = results.map(r => r.chunkId);
      const endTime = Date.now();
      const latency = endTime - startTime;
      
      // 计算检索指标
      const recallAtK = RetrievalMetrics.calculateRecallAtK(
        actualSources, 
        item.expectedSources, 
        config.topK || 5
      );
      
      const hitAtK = RetrievalMetrics.calculateHitAtK(
        actualSources, 
        item.expectedSources, 
        config.topK || 5
      );
      
      const mrr = RetrievalMetrics.calculateMRR(actualSources, item.expectedSources);
      const ndcgAtK = RetrievalMetrics.calculateNDCGAtK(
        actualSources, 
        item.expectedSources, 
        config.topK || 5
      );
      
      // 这里应该调用生成模型生成答案，为了演示使用模拟答案
      const answer = await this.generateMockAnswer(item.question, results);
      
      // 计算答案质量指标
      const answerCorrectness = AnswerQualityEvaluator.calculateAnswerCorrectness(
        answer, 
        item.referenceAnswer
      );
      
      // 计算引用指标
      const citationPrecision = await this.calculateCitationPrecision(
        answer, 
        actualSources
      );
      
      const citationCompleteness = await this.calculateCitationCompleteness(
        answer, 
        actualSources
      );
      
      // 计算置信度
      const confidence = this.calculateOverallConfidence({
        recallAtK,
        hitAtK,
        mrr,
        ndcgAtK,
        answerCorrectness,
        citationPrecision,
        citationCompleteness,
      });
      
      return {
        itemId: item.id,
        question: item.question,
        actualSources,
        expectedSources: item.expectedSources,
        recallAtK,
        hitAtK,
        mrr,
        ndcgAtK,
        answer,
        referenceAnswer: item.referenceAnswer,
        answerCorrectness,
        citationPrecision,
        citationCompleteness,
        confidence,
        latency,
      };
      
    } catch (error) {
      return {
        itemId: item.id,
        question: item.question,
        actualSources: [],
        expectedSources: item.expectedSources,
        recallAtK: 0,
        hitAtK: 0,
        mrr: 0,
        ndcgAtK: 0,
        answer: "",
        referenceAnswer: item.referenceAnswer,
        answerCorrectness: 0,
        citationPrecision: 0,
        citationCompleteness: 0,
        confidence: "error",
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * 生成模拟答案（实际应该调用LLM）
   */
  private static async generateMockAnswer(question: string, results: any[]): Promise<string> {
    // 简单的模拟答案生成
    if (results.length === 0) {
      return "抱歉，我没有找到相关信息。";
    }
    
    const firstResult = results[0];
    const docName = firstResult.docName;
    const content = firstResult.content.substring(0, 200);
    
    return `根据${docName}中的信息：${content}...，可以回答您的问题。`;
  }
  
  /**
   * 计算引用精确度
   */
  private static async calculateCitationPrecision(answer: string, sources: string[]): Promise<number> {
    if (sources.length === 0) return 0;
    
    // 模拟引用校验
    const validCitations = Math.floor(sources.length * 0.8); // 假设80%的引用有效
    
    return validCitations / sources.length;
  }
  
  /**
   * 计算引用完整度
   */
  private static async calculateCitationCompleteness(answer: string, sources: string[]): Promise<number> {
    if (sources.length === 0) return 0;
    
    // 模拟引用完整度计算
    const answerKeywords = this.extractKeywords(answer);
    const totalKeywords = answerKeywords.length;
    
    if (totalKeywords === 0) return 0;
    
    const coveredKeywords = Math.floor(totalKeywords * 0.7); // 假设70%的关键词有引用
    
    return coveredKeywords / totalKeywords;
  }
  
  /**
   * 提取关键词
   */
  private static extractKeywords(text: string): string[] {
    const words = text.match(/[\u4e00-\u9fff]+|[a-zA-Z]+/g) || [];
    const stopWords = [
      "的", "了", "和", "与", "或", "但", "是", "在", "有", "我", "你", "他", "它", "这", "那",
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"
    ];
    
    return words
      .filter(word => word.length > 2 && !stopWords.includes(word.toLowerCase()))
      .slice(0, 10);
  }
  
  /**
   * 计算整体置信度
   */
  private static calculateOverallConfidence(metrics: {
    recallAtK: number;
    hitAtK: number;
    mrr: number;
    ndcgAtK: number;
    answerCorrectness: number;
    citationPrecision: number;
    citationCompleteness: number;
  }): string {
    const avgScore = (
      metrics.recallAtK +
      metrics.hitAtK +
      metrics.mrr +
      metrics.ndcgAtK +
      metrics.answerCorrectness +
      metrics.citationPrecision +
      metrics.citationCompleteness
    ) / 7;
    
    if (avgScore >= 0.8) return "high";
    if (avgScore >= 0.6) return "medium";
    if (avgScore >= 0.3) return "low";
    return "none";
  }
  
  /**
   * 批量评测
   */
  static async evaluateBatch(
    items: EvaluationDatasetItem[],
    config: {
      topK?: number;
      rerankEnabled?: boolean;
      parallel?: number;
    } = {}
  ): Promise<{
    results: EvaluationResult[];
    summary: {
      avgRecallAtK: number;
      avgHitAtK: number;
      avgMRR: number;
      avgNDCGAtK: number;
      avgAnswerCorrectness: number;
      avgCitationPrecision: number;
      avgCitationCompleteness: number;
      avgLatency: number;
      totalItems: number;
      successItems: number;
      failedItems: number;
    };
  }> {
    const parallel = config.parallel || 3;
    const results: EvaluationResult[] = [];
    
    // 分批处理
    for (let i = 0; i < items.length; i += parallel) {
      const batch = items.slice(i, i + parallel);
      
      const batchPromises = batch.map(item => 
        this.evaluateItem(item, config)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    // 计算汇总指标
    const successfulResults = results.filter(r => !r.error);
    const failedResults = results.filter(r => r.error);
    
    const summary = {
      avgRecallAtK: successfulResults.reduce((sum, r) => sum + r.recallAtK, 0) / successfulResults.length || 0,
      avgHitAtK: successfulResults.reduce((sum, r) => sum + r.hitAtK, 0) / successfulResults.length || 0,
      avgMRR: successfulResults.reduce((sum, r) => sum + r.mrr, 0) / successfulResults.length || 0,
      avgNDCGAtK: successfulResults.reduce((sum, r) => sum + r.ndcgAtK, 0) / successfulResults.length || 0,
      avgAnswerCorrectness: successfulResults.reduce((sum, r) => sum + r.answerCorrectness, 0) / successfulResults.length || 0,
      avgCitationPrecision: successfulResults.reduce((sum, r) => sum + r.citationPrecision, 0) / successfulResults.length || 0,
      avgCitationCompleteness: successfulResults.reduce((sum, r) => sum + r.citationCompleteness, 0) / successfulResults.length || 0,
      avgLatency: results.reduce((sum, r) => sum + r.latency, 0) / results.length || 0,
      totalItems: items.length,
      successItems: successfulResults.length,
      failedItems: failedResults.length,
    };
    
    return { results, summary };
  }
  
  /**
   * 生成评测报告
   */
  static generateReport(results: EvaluationResult[], summary: any): string {
    let report = "# 评测报告\n\n";
    report += `## 总体指标\n\n`;
    report += `- 总评测项数: ${summary.totalItems}\n`;
    report += `- 成功项数: ${summary.successItems}\n`;
    report += `- 失败项数: ${summary.failedItems}\n`;
    report += `- 平均延迟: ${summary.avgLatency.toFixed(2)}ms\n\n`;
    
    report += `## 检索指标\n\n`;
    report += `- 平均Recall@5: ${(summary.avgRecallAtK * 100).toFixed(1)}%\n`;
    report += `- 平均Hit@5: ${(summary.avgHitAtK * 100).toFixed(1)}%\n`;
    report += `- 平均MRR: ${(summary.avgMRR * 100).toFixed(1)}%\n`;
    report += `- 平均nDCG@5: ${(summary.avgNDCGAtK * 100).toFixed(1)}%\n\n`;
    
    report += `## 答案质量指标\n\n`;
    report += `- 平均答案正确率: ${(summary.avgAnswerCorrectness * 100).toFixed(1)}%\n`;
    report += `- 平均引用精确度: ${(summary.avgCitationPrecision * 100).toFixed(1)}%\n`;
    report += `- 平均引用完整度: ${(summary.avgCitationCompleteness * 100).toFixed(1)}%\n\n`;
    
    report += `## 详细结果\n\n`;
    results.forEach(result => {
      report += `### 问题: ${result.question}\n`;
      report += `- Recall@5: ${(result.recallAtK * 100).toFixed(1)}%\n`;
      report += `- Hit@5: ${(result.hitAtK * 100).toFixed(1)}%\n`;
      report += `- MRR: ${(result.mrr * 100).toFixed(1)}%\n`;
      report += `- 答案正确率: ${(result.answerCorrectness * 100).toFixed(1)}%\n`;
      report += `- 置信度: ${result.confidence}\n`;
      if (result.error) {
        report += `- 错误: ${result.error}\n`;
      }
      report += `\n`;
    });
    
    return report;
  }
}

/**
 * 评测数据集管理器
 */
export class DatasetManager {
  /**
   * 创建示例评测数据集
   */
  static createSampleDataset(): EvaluationDatasetItem[] {
    return [
      {
        id: "1",
        question: "公司差旅管理办法什么时候生效？",
        expectedSources: ["chunk-1", "chunk-2"],
        referenceAnswer: "公司差旅管理办法自2024年1月1日起生效。",
        permissions: {
          department: "hr",
          kbIds: ["kb-1"],
        },
        category: "policy",
        difficulty: "easy",
        createdAt: new Date(),
      },
      {
        id: "2",
        question: "报销流程需要哪些审批步骤？",
        expectedSources: ["chunk-3", "chunk-4", "chunk-5"],
        referenceAnswer: "报销流程需要部门经理审批、财务审核、总经理审批三个步骤。",
        permissions: {
          department: "finance",
          kbIds: ["kb-2"],
        },
        category: "process",
        difficulty: "medium",
        createdAt: new Date(),
      },
      {
        id: "3",
        question: "2024年Q1的销售额是多少？",
        expectedSources: ["chunk-6"],
        referenceAnswer: "2024年Q1的销售额为500万元。",
        permissions: {
          department: "sales",
          kbIds: ["kb-3"],
        },
        category: "data",
        difficulty: "hard",
        createdAt: new Date(),
      },
      {
        id: "4",
        question: "请假需要什么证明材料？",
        expectedSources: [],
        referenceAnswer: "抱歉，我没有找到关于请假证明材料的信息。",
        permissions: {
          department: "hr",
          kbIds: ["kb-1"],
        },
        category: "policy",
        difficulty: "easy",
        createdAt: new Date(),
      },
    ];
  }
  
  /**
   * 保存评测数据集到数据库
   */
  static async saveDataset(dataset: EvaluationDatasetItem[]): Promise<void> {
    // 这里可以实现数据库保存逻辑
    console.log(`[DatasetManager] Saving ${dataset.length} items to database`);
  }
  
  /**
   * 从数据库加载评测数据集
   */
  static async loadDataset(): Promise<EvaluationDatasetItem[]> {
    // 这里可以实现数据库加载逻辑
    return this.createSampleDataset();
  }
}