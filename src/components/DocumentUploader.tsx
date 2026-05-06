"use client";

import { useState, useCallback } from "react";
import styles from "./DocumentUploader.module.css";

export default function DocumentUploader() {
  const [kbId, setKbId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<
    { filename: string; status: string }[]
  >([]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || !kbId) return;

      setUploading(true);
      const newResults: { filename: string; status: string }[] = [];

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
            newResults.push({ filename: file.name, status: "处理中" });
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
