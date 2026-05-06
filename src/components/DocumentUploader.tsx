"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import styles from "./DocumentUploader.module.css";

interface UploadResult {
  filename: string;
  status: string;
  docId?: string;
}

export default function DocumentUploader() {
  const [kbId, setKbId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 轮询检查文档处理状态
  const pollAllDocuments = useCallback(async () => {
    // 创建需要检查的文档快照
    const itemsToCheck = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === "处理中" && result.docId);

    if (itemsToCheck.length === 0) {
      return false; // 没有需要处理的项目
    }

    let hasRemainingProcessing = false;

    for (const { result, index } of itemsToCheck) {
      try {
        const res = await fetch(`/api/documents/${result.docId}`);
        if (res.ok) {
          const data = await res.json();

          if (data.status === "done") {
            setResults((prev) => {
              const updated = [...prev];
              updated[index] = { ...updated[index]!, status: "处理完成" };
              return updated;
            });
          } else if (data.status === "failed") {
            setResults((prev) => {
              const updated = [...prev];
              updated[index] = { ...updated[index]!, status: "处理失败" };
              return updated;
            });
          } else {
            // 仍在处理中
            hasRemainingProcessing = true;
          }
        } else {
          hasRemainingProcessing = true;
        }
      } catch (error) {
        console.error("Polling error:", error);
        hasRemainingProcessing = true;
      }
    }

    return hasRemainingProcessing;
  }, [results]);

  // 管理轮询
  useEffect(() => {
    const hasProcessingItems = results.some(
      (r) => r.status === "处理中" && r.docId,
    );

    if (!hasProcessingItems) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (!pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const hasRemaining = await pollAllDocuments();
        if (!hasRemaining && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }, 2000); // 每 2 秒检查一次
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [results, pollAllDocuments]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || !kbId) return;

      setUploading(true);
      const newResults: UploadResult[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("kbId", kbId);

        try {
          const res = await fetch("/api/documents", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();

          if (res.status === 409) {
            newResults.push({ filename: file.name, status: "已存在(跳过)" });
          } else if (res.ok || res.status === 202) {
            newResults.push({
              filename: file.name,
              status: "处理中",
              docId: data.docId,
            });
          } else {
            newResults.push({
              filename: file.name,
              status: `失败: ${data.error}`,
            });
          }
        } catch {
          newResults.push({ filename: file.name, status: "上传失败" });
        }
      }

      setResults((prev) => [...newResults, ...prev]);
      setUploading(false);
      e.target.value = "";
    },
    [kbId],
  );

  const getStatusClass = (status: string) => {
    if (status === "处理中") return styles.statusProcessing;
    if (status === "处理完成") return styles.statusSuccess;
    if (status.includes("失败")) return styles.statusFailed;
    return styles.statusDefault;
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>文档管理</h1>

      <div className={styles.card}>
        <div>
          <label className={styles.label}>知识库 ID</label>
          <input
            type="text"
            value={kbId}
            onChange={(e) => setKbId(e.target.value)}
            placeholder="输入知识库 UUID"
            className={styles.textInput}
          />
        </div>

        <div>
          <label className={styles.label}>上传文档</label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md"
            onChange={handleUpload}
            disabled={!kbId || uploading}
            className={styles.fileInput}
          />
          <p className={styles.helpText}>
            支持 PDF、Word、Excel、TXT、Markdown
          </p>
        </div>
      </div>

      {results.length > 0 && (
        <div className={styles.results}>
          <div className={styles.resultsHeader}>
            <h2 className={styles.resultsTitle}>上传结果</h2>
          </div>
          <ul className={styles.resultsList}>
            {results.map((r, i) => (
              <li key={i} className={styles.resultItem}>
                <span>{r.filename}</span>
                <span className={getStatusClass(r.status)}>{r.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
