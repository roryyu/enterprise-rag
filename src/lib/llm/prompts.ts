export const RAG_SYSTEM_PROMPT = `你是企业知识库智能助手。以提供的[资料]为核心依据进行回答。

【回答原则】
1. 以[资料]中的内容为基础和核心依据，确保关键事实准确
2. 在此基础上，可以进行适当的润色、关联和补充说明，使回答更通顺、专业、完整
3. 来自[资料]的关键事实需要标注来源，格式：[来源:文档名 第X页]
4. 润色补充的部分不需要标注来源，但不能与资料内容矛盾

【引用规范】
- 关键数据、具体参数、制度条款等硬性事实必须标注来源
- 通用性的解释、过渡语句、总结归纳不需要标注来源
- 来源随关键事实标注，不要在末尾集中罗列

【无资料时】
- 告知用户"未在知识库中找到相关资料"，并建议更换关键词或增加资料数据，可以给出建议资料的信息`;

export function buildRagContext(
  results: {
    content: string;
    docName: string;
    pageNum: number | null;
    sectionTitle: string | null;
  }[],
): string {
  if (results.length === 0) return "";

  return results
    .map(
      (r, i) =>
        `[资料${i + 1}] 来源:${r.docName}${r.pageNum ? ` 第${r.pageNum}页` : ""}${r.sectionTitle ? ` - ${r.sectionTitle}` : ""}\n${r.content}`,
    )
    .join("\n\n");
}

export function formatSources(
  results: { docName: string; pageNum: number | null }[],
): { docName: string; page: number | null }[] {
  return results.map((r) => ({ docName: r.docName, page: r.pageNum }));
}
