import { generateEmbeddings } from "@/lib/ingestion/embedder";

/**
 * 查询类型枚举
 */
export enum QueryType {
  FACT_QUERY = "fact_query",           // 事实查询
  PROCESS_QUERY = "process_query",       // 流程查询
  COMPARISON_QUERY = "comparison_query", // 对比查询
  SUMMARY_QUERY = "summary_query",       // 总结查询
  CHAT_QUERY = "chat_query",            // 闲聊查询
  CALCULATION_QUERY = "calculation_query", // 计算查询
  STRUCTURED_QUERY = "structured_query", // 结构化查询
  IRRELEVANT_QUERY = "irrelevant_query", // 无关问题
}

/**
 * 查询分析结果
 */
export interface QueryAnalysis {
  type: QueryType;
  entities: string[];
  timeConstraints: string[];
  departmentConstraints: string[];
  documentTypeConstraints: string[];
  keywords: string[];
  confidence: number; // 置信度 0-1
  needsRewrite: boolean;
  rewriteVariants: string[];
}

/**
 * 实体提取器
 */
export class EntityExtractor {
  /**
   * 从查询中提取实体
   */
  static extractEntities(query: string): string[] {
    const entities: string[] = [];
    
    // 提取产品名（假设产品名包含特定模式）
    const productPattern = /产品[:：]?\s*([^，。！？\s]+)/g;
    let match: RegExpExecArray | null;
    while ((match = productPattern.exec(query)) !== null) {
      entities.push(match[1]!.trim());
    }

    // 提取部门名
    const deptPattern = /部门[:：]?\s*([^，。！？\s]+)/g;
    while ((match = deptPattern.exec(query)) !== null) {
      entities.push(match[1]!.trim());
    }

    // 提取时间
    const timePattern = /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2}|今天|明天|昨天|本周|本月|去年)/g;
    while ((match = timePattern.exec(query)) !== null) {
      entities.push(match[1]!.trim());
    }

    // 提取文档类型
    const docTypePattern = /(\.docx?|\.pdf|\.xlsx?|\.txt|政策|制度|规定|方案|报告|通知|公告)/g;
    while ((match = docTypePattern.exec(query)) !== null) {
      entities.push(match[1]!.trim());
    }
    
    return [...new Set(entities)];
  }
  
  /**
   * 提取约束条件
   */
  static extractConstraints(query: string): {
    timeConstraints: string[];
    departmentConstraints: string[];
    documentTypeConstraints: string[];
  } {
    const timeConstraints: string[] = [];
    const departmentConstraints: string[] = [];
    const documentTypeConstraints: string[] = [];
    
    // 时间约束
    const timePatterns = [
      /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{2})/g,
      /(今天|明天|昨天|本周|本月|去年)/g,
      /(生效时间|实施时间|发布时间)/g,
    ];
    
    timePatterns.forEach((pattern) => {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(query)) !== null && m[1]) {
        timeConstraints.push(m[1]);
      }
    });

    // 部门约束
    const deptPatterns = [
      /部门[:：]?\s*([^，。！？\s]+)/g,
      /([^，。！？\s]+)部门/g,
    ];

    deptPatterns.forEach((pattern) => {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(query)) !== null && m[1]) {
        departmentConstraints.push(m[1]);
      }
    });

    // 文档类型约束
    const docPatterns = [
      /政策|制度|规定|方案|报告|通知|公告/g,
      /\.docx?|\.pdf|\.xlsx?|\.txt/g,
    ];

    docPatterns.forEach((pattern) => {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(query)) !== null) {
        documentTypeConstraints.push(m[0]);
      }
    });
    
    return {
      timeConstraints: [...new Set(timeConstraints)],
      departmentConstraints: [...new Set(departmentConstraints)],
      documentTypeConstraints: [...new Set(documentTypeConstraints)],
    };
  }
}

/**
 * 查询分类器
 */
export class QueryClassifier {
  /**
   * 判断查询类型
   */
  static classifyQuery(query: string): QueryType {
    const lowerQuery = query.toLowerCase();
    
    // 事实查询关键词
    const factKeywords = ["什么时候", "何时", "哪里", "谁", "什么", "哪个", "多少", "几", "日期", "时间", "地点", "姓名", "名称"];
    
    // 流程查询关键词
    const processKeywords = ["流程", "步骤", "如何", "怎么", "操作", "方法", "程序", "步骤", "顺序"];
    
    // 对比查询关键词
    const comparisonKeywords = ["对比", "比较", "区别", "不同", "差异", "优缺点", "vs", "和...相比", "与...相比"];
    
    // 总结查询关键词
    const summaryKeywords = ["总结", "概括", "概述", "归纳", "要点", "主要内容", "核心", "关键点"];
    
    // 计算查询关键词
    const calculationKeywords = ["计算", "统计", "总和", "平均", "百分比", "比例", "增长", "减少", "变化"];
    
    // 结构化查询关键词
    const structuredKeywords = ["表格", "数据", "列表", "清单", "统计", "报表", "图表", "数字"];
    
    // 闲聊查询关键词
    const chatKeywords = ["你好", "谢谢", "再见", "请", "麻烦", "帮助", "介绍一下", "你是谁"];
    
    // 检查是否为闲聊
    if (chatKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.CHAT_QUERY;
    }
    
    // 检查是否为计算查询
    if (calculationKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.CALCULATION_QUERY;
    }
    
    // 检查是否为结构化查询
    if (structuredKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.STRUCTURED_QUERY;
    }
    
    // 检查是否为对比查询
    if (comparisonKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.COMPARISON_QUERY;
    }
    
    // 检查是否为流程查询
    if (processKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.PROCESS_QUERY;
    }
    
    // 检查是否为总结查询
    if (summaryKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.SUMMARY_QUERY;
    }
    
    // 检查是否为事实查询
    if (factKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return QueryType.FACT_QUERY;
    }
    
    // 默认为事实查询
    return QueryType.FACT_QUERY;
  }
  
  /**
   * 计算查询置信度
   */
  static calculateConfidence(query: string, type: QueryType): number {
    const lowerQuery = query.toLowerCase();
    const length = query.length;
    
    // 根据查询长度和类型计算置信度
    let baseConfidence = 0.5;
    
    // 长查询置信度更高
    if (length > 20) baseConfidence += 0.2;
    if (length > 50) baseConfidence += 0.1;
    
    // 根据类型调整置信度
    switch (type) {
      case QueryType.FACT_QUERY:
        baseConfidence += 0.1;
        break;
      case QueryType.PROCESS_QUERY:
      case QueryType.COMPARISON_QUERY:
        baseConfidence += 0.15;
        break;
      case QueryType.SUMMARY_QUERY:
        baseConfidence += 0.2;
        break;
      case QueryType.CALCULATION_QUERY:
      case QueryType.STRUCTURED_QUERY:
        baseConfidence += 0.25;
        break;
      case QueryType.CHAT_QUERY:
        baseConfidence += 0.05;
        break;
      case QueryType.IRRELEVANT_QUERY:
        baseConfidence -= 0.3;
        break;
    }
    
    return Math.max(0, Math.min(1, baseConfidence));
  }
}

/**
 * 查询改写器
 */
export class QueryRewriter {
  /**
   * 判断是否需要改写
   */
  static needsRewrite(query: string, type: QueryType): boolean {
    // 简单事实查询通常不需要改写
    if (type === QueryType.FACT_QUERY && query.length < 30) {
      return false;
    }
    
    // 检查是否有指代词
    const pronouns = ["这个", "那个", "这些", "那些", "它", "他们", "这里", "那里", "当前", "上述"];
    const hasPronouns = pronouns.some(pronoun => query.includes(pronoun));
    
    // 检查是否有多轮对话特征
    const hasMultiTurnFeatures = query.includes("刚才") || query.includes("之前") || query.includes("刚才提到的");
    
    return hasPronouns || hasMultiTurnFeatures || query.length > 100;
  }
  
  /**
   * 生成查询变体
   */
  static generateRewriteVariants(query: string, analysis: QueryAnalysis): string[] {
    const variants: string[] = [];
    
    // 原始查询
    variants.push(query);
    
    // 如果检测到指代，尝试消除指代
    if (query.includes("这个") || query.includes("那个")) {
      const rewritten = query
        .replace(/这个/g, "")
        .replace(/那个/g, "")
        .replace(/这些/g, "")
        .replace(/那些/g, "")
        .replace(/\s+/g, " ")
        .trim();
      
      if (rewritten !== query) {
        variants.push(rewritten);
      }
    }
    
    // 如果是多轮对话，结合上下文改写
    if (query.includes("刚才") || query.includes("之前")) {
      const rewritten = query
        .replace(/刚才/g, "之前讨论的")
        .replace(/之前/g, "之前提到的")
        .replace(/\s+/g, " ")
        .trim();
      
      if (rewritten !== query) {
        variants.push(rewritten);
      }
    }
    
    // 如果查询过长，尝试简化
    if (query.length > 100) {
      const simplified = query
        .replace(/关于/g, "")
        .replace(/请问/g, "")
        .replace(/我想知道/g, "")
        .replace(/\s+/g, " ")
        .trim();
      
      if (simplified !== query) {
        variants.push(simplified);
      }
    }
    
    // 生成语义改写（如果需要）
    if (analysis.entities.length > 0) {
      const entityRewrite = analysis.entities
        .map(entity => `${entity} 相关`)
        .join("、");
      
      if (entityRewrite) {
        variants.push(`${query}，${entityRewrite}`);
      }
    }
    
    // 限制变体数量
    return variants.slice(0, 3);
  }
}

/**
 * 查询处理器主类
 */
export class QueryProcessor {
  /**
   * 分析查询
   */
  static async analyzeQuery(query: string, previousQuery?: string): Promise<QueryAnalysis> {
    // 分类查询类型
    const type = QueryClassifier.classifyQuery(query);
    
    // 提取实体和约束
    const entities = EntityExtractor.extractEntities(query);
    const { timeConstraints, departmentConstraints, documentTypeConstraints } = EntityExtractor.extractConstraints(query);
    
    // 提取关键词
    const keywords = this.extractKeywords(query);
    
    // 计算置信度
    const confidence = QueryClassifier.calculateConfidence(query, type);
    
    // 判断是否需要改写
    const needsRewrite = this.needsRewrite(query, type, previousQuery);
    
    // 生成改写变体
    const rewriteVariants = needsRewrite 
      ? QueryRewriter.generateRewriteVariants(query, {
          type,
          entities,
          timeConstraints,
          departmentConstraints,
          documentTypeConstraints,
          keywords,
          confidence,
          needsRewrite: true,
          rewriteVariants: [],
        })
      : [query];
    
    return {
      type,
      entities,
      timeConstraints,
      departmentConstraints,
      documentTypeConstraints,
      keywords,
      confidence,
      needsRewrite,
      rewriteVariants,
    };
  }
  
  /**
   * 判断是否需要改写
   */
  private static needsRewrite(query: string, type: QueryType, previousQuery?: string): boolean {
    // 如果有之前的查询，检查是否为多轮对话
    if (previousQuery) {
      return QueryRewriter.needsRewrite(query, type) || this.isMultiTurnQuery(query, previousQuery);
    }
    
    return QueryRewriter.needsRewrite(query, type);
  }
  
  /**
   * 判断是否为多轮查询
   */
  private static isMultiTurnQuery(currentQuery: string, previousQuery: string): boolean {
    const currentLower = currentQuery.toLowerCase();
    const previousLower = previousQuery.toLowerCase();
    
    // 检查是否指代之前的查询
    const references = [
      "刚才", "之前", "上面", "前面", "提到的", "讨论的", "说的", "问的"
    ];
    
    return references.some(ref => currentLower.includes(ref));
  }
  
  /**
   * 提取关键词
   */
  private static extractKeywords(query: string): string[] {
    // 简单的关键词提取，可以后续替换为更复杂的算法
    const words = query.match(/[\u4e00-\u9fff]+|[a-zA-Z]+/g) || [];
    const stopWords = ["的", "了", "和", "与", "或", "但", "是", "在", "有", "我", "你", "他", "它", "这", "那"];
    
    return words
      .filter(word => word.length > 1 && !stopWords.includes(word))
      .slice(0, 10); // 限制关键词数量
  }
  
  /**
   * 处理多轮对话
   */
  static async processMultiTurnQuery(
    currentQuery: string,
    previousQueries: string[],
    conversationHistory?: any[]
  ): Promise<QueryAnalysis> {
    // 获取最近的查询作为上下文
    const recentQuery = previousQueries[previousQueries.length - 1] || "";
    
    // 分析当前查询
    const analysis = await this.analyzeQuery(currentQuery, recentQuery);
    
    // 如果是多轮查询，增强实体提取
    if (conversationHistory && conversationHistory.length > 0) {
      // 从历史对话中提取实体
      const historicalEntities = conversationHistory
        .map(msg => msg.content)
        .flatMap(EntityExtractor.extractEntities);
      
      // 合并历史实体
      analysis.entities = [...new Set([...analysis.entities, ...historicalEntities])];
    }
    
    return analysis;
  }
}

/**
 * 查询处理工具函数
 */
export class QueryUtils {
  /**
   * 格式化查询用于日志
   */
  static formatQueryForLogging(query: string, analysis: QueryAnalysis): string {
    return JSON.stringify({
      originalQuery: query,
      type: analysis.type,
      entities: analysis.entities,
      confidence: analysis.confidence,
      needsRewrite: analysis.needsRewrite,
      rewriteVariants: analysis.rewriteVariants,
    }, null, 2);
  }
  
  /**
   * 检查查询是否为低质量查询
   */
  static isLowQualityQuery(query: string): boolean {
    // 检查查询长度
    if (query.length < 3) return true;
    
    // 检查是否包含无意义字符
    if (/^[^a-zA-Z\u4e00-\u9fff]+$/.test(query)) return true;
    
    // 检查是否为重复字符
    if (/^(.)\1+$/.test(query)) return true;
    
    // 检查是否为纯数字
    if (/^\d+$/.test(query)) return true;
    
    return false;
  }
  
  /**
   * 清理查询文本
   */
  static cleanQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\u4e00-\u9fffa-zA-Z0-9\s\-\+\(\)\[\]\{\}\.,!?;:]/g, "");
  }
}