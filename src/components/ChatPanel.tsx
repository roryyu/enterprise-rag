"use client";

import { useState, useRef, useCallback, useMemo, Fragment } from "react";
import styles from "./ChatPanel.module.css";

interface Source {
  docName: string;
  page: number | null;
  section: string | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

// 解析内容中的 [来源:文档名 第X页] 标注，提取为角标
function parseContentWithRefs(text: string) {
  const regex = /\[来源:(.+?)(?:\s+第(\d+)页)?\]/g;
  const parts: { type: "text" | "ref"; value: string; page?: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "ref", value: match[1]!.trim(), page: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  // 去重收集来源列表
  const refMap = new Map<
    string,
    { docName: string; page: string | null; index: number }
  >();
  const refIndices: number[] = [];
  let refCounter = 0;

  for (const part of parts) {
    if (part.type === "ref") {
      const key = `${part.value}|${part.page || ""}`;
      if (!refMap.has(key)) {
        refCounter++;
        refMap.set(key, {
          docName: part.value,
          page: part.page || null,
          index: refCounter,
        });
      }
      refIndices.push(refMap.get(key)!.index);
    }
  }

  return { parts, refList: [...refMap.values()], refIndices };
}

// 渲染带角标的消息内容
function MessageContent({ content }: { content: string }) {
  const { parts, refList, refIndices } = useMemo(
    () => parseContentWithRefs(content),
    [content],
  );

  // 如果没有来源标注，直接渲染纯文本
  if (refList.length === 0) {
    return <p>{content}</p>;
  }

  let refIndexPointer = 0;
  return (
    <>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {parts.map((part, i) => {
          if (part.type === "text") {
            return <Fragment key={i}>{part.value}</Fragment>;
          }
          const correctIndex = refIndices[refIndexPointer++]!;
          return (
            <sup key={i} className={styles.ref}>
              {correctIndex}
            </sup>
          );
        })}
      </p>
      <div className={styles.refList}>
        {refList.map((ref, i) => (
          <div key={i} className={styles.refItem}>
            <sup className={styles.refNum}>{ref.index}</sup>
            {ref.docName}
            {ref.page ? ` 第${ref.page}页` : ""}
          </div>
        ))}
      </div>
    </>
  );
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [department, setDepartment] = useState("default");
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || loading) return;

      const userMessage = input.trim();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      setLoading(true);

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Department": department,
          },
          body: JSON.stringify({
            query: userMessage,
            conversationId,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error("请求失败");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("无法读取响应流");

        const decoder = new TextDecoder();
        let assistantContent = "";
        let sources: Source[] = [];

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", sources: [] },
        ]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content") {
                assistantContent += parsed.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantContent,
                    sources,
                  };
                  return updated;
                });
              } else if (parsed.type === "sources") {
                sources = parsed.sources;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1]!,
                    sources,
                  };
                  return updated;
                });
              } else if (parsed.type === "done") {
                setConversationId(parsed.conversationId);
              }
            } catch {
              // skip unparseable chunks
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "请求失败，请重试" },
          ]);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [input, loading, conversationId, department],
  );

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>企业知识库问答</h1>
        <div className={styles.headerControls}>
          <label className={styles.deptLabel}>部门:</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={styles.deptSelect}
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
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            请输入问题，我将基于企业知识库为您解答
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`${styles.messageRow} ${msg.role === "user" ? styles.messageRowUser : styles.messageRowAssistant}`}
          >
            <div
              className={`${styles.bubble} ${msg.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}`}
            >
              {msg.role === "user" ? (
                <p>{msg.content}</p>
              ) : (
                <MessageContent content={msg.content} />
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className={styles.loading}>正在检索并生成回答...</div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <div className={styles.inputRow}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入您的问题..."
            className={styles.input}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className={styles.submitBtn}
          >
            发送
          </button>
        </div>
      </form>
    </div>
  );
}
