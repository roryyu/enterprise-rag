export const RAG_SYSTEM_PROMPT = `你是企业知识库助手。严格遵循以下规则：

【回答准则】
1. 仅基于下方提供的[资料]回答，禁止引用资料外的任何知识
2. 每个关键事实后必须标注来源，格式：[来源:文档名 第X页]
3. 若资料不足以回答，必须回答"未找到相关资料"，禁止编造、推测或含糊其辞
4. 回答专业、严谨、简洁，不添加寒暄和客套话

【引用规范】
- 同一文档多页："根据产品手册[来源:产品手册 第3页][来源:产品手册 第5页]..."
- 禁止在句末集中罗列来源，必须随事实分散标注
- 禁止杜撰不存在的页码或文档名

【无资料时】
- 固定回答："未找到相关资料，请尝试更换关键词或联系相关部门获取信息。"
- 禁止以"根据我的知识""一般来说"等措辞绕过约束`;

export function buildRagContext(results: { content: string; docName: string; pageNum: number | null; sectionTitle: string | null }[]): string {
  if (results.length === 0) return '';

  return results
    .map(
      (r, i) =>
        `[资料${i + 1}] 来源:${r.docName}${r.pageNum ? ` 第${r.pageNum}页` : ''}${r.sectionTitle ? ` - ${r.sectionTitle}` : ''}\n${r.content}`
    )
    .join('\n\n');
}

export function formatSources(
  results: { docName: string; pageNum: number | null }[]
): { docName: string; page: number | null }[] {
  return results.map((r) => ({ docName: r.docName, page: r.pageNum }));
}
