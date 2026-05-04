import OpenAI from 'openai';
import { RAG_SYSTEM_PROMPT, buildRagContext, formatSources } from './prompts';
import { HybridSearchResult } from '@/lib/retrieval/hybrid';

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI();
  }
  return openai;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function* streamChat(
  userMessage: string,
  searchResults: HybridSearchResult[],
  history: ChatMessage[]
): AsyncGenerator<string> {
  const context = buildRagContext(searchResults);
  const contextBlock = context
    ? `\n\n---参考资料---\n${context}\n---参考资料结束---\n\n请基于以上资料回答用户问题。如果资料不足以回答，如实告知。`
    : '\n\n未检索到相关资料，请如实告知用户"未找到相关资料"，不要编造。';

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: RAG_SYSTEM_PROMPT + contextBlock },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const stream = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }

  // Yield sources at the end
  if (searchResults.length > 0) {
    const sourceList = searchResults
      .map((r) => `${r.docName}${r.pageNum ? ` 第${r.pageNum}页` : ''}`)
      .join(' | ');
    yield `\n\n---\n📎 来源：${sourceList}`;
  }
}
