'use client';

import { useState, useRef, useCallback } from 'react';

interface Source {
  docName: string;
  page: number | null;
  section: string | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [department, setDepartment] = useState('default');
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || loading) return;

      const userMessage = input.trim();
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
      setLoading(true);

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Department': department,
          },
          body: JSON.stringify({
            query: userMessage,
            conversationId,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error('请求失败');

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');

        const decoder = new TextDecoder();
        let assistantContent = '';
        let sources: Source[] = [];

        setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: [] }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content') {
                assistantContent += parsed.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: assistantContent,
                    sources,
                  };
                  return updated;
                });
              } else if (parsed.type === 'sources') {
                sources = parsed.sources;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1]!,
                    sources,
                  };
                  return updated;
                });
              } else if (parsed.type === 'done') {
                setConversationId(parsed.conversationId);
              }
            } catch {
              // skip unparseable chunks
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: '请求失败，请重试' },
          ]);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [input, loading, conversationId, department]
  );

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">企业知识库问答</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500">部门:</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="default">默认</option>
            <option value="tech">技术部</option>
            <option value="hr">人力资源</option>
            <option value="finance">财务部</option>
            <option value="legal">法务部</option>
          </select>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            请输入问题，我将基于企业知识库为您解答
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] rounded-lg px-4 py-3 whitespace-pre-wrap text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border text-gray-800'
              }`}
            >
              {msg.content}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                  📎 来源：{msg.sources.map((s) => `${s.docName}${s.page ? ` 第${s.page}页` : ''}`).join(' | ')}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === 'user' && (
          <div className="text-gray-400 text-sm">正在检索并生成回答...</div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="bg-white border-t px-6 py-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入您的问题..."
            className="flex-1 border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  );
}
