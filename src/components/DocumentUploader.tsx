"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import BackHome from "./BackHome";
import styles from "./DocumentUploader.module.css";

interface UploadResult {
  filename: string;
  status: string;
  docId?: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
}

interface DocumentItem {
  id: string;
  kbId: string;
  filename: string;
  fileType: string;
  status: string; // pending/processing/done/failed
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  processing: "处理中",
  done: "已完成",
  failed: "失败",
};

// 使用 Intl 格式化日期时间，避免硬编码格式
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function StatusPill({ status }: { status: string }) {
  let cls = styles.statusNeutral;
  if (status === "processing" || status === "pending") cls = styles.statusBlue;
  else if (status === "done") cls = styles.statusGreen;
  else if (status === "failed") cls = styles.statusRed;

  return (
    <span className={`${styles.statusPill} ${cls}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function DocumentUploader() {
  const [kbId, setKbId] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newKbName, setNewKbName] = useState("");
  const [creatingKb, setCreatingKb] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 获取知识库列表
  const fetchKnowledgeBases = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge');
      if (res.ok) {
        const data = await res.json();
        setKnowledgeBases(data.knowledgeBases);
        setLoadingKbs(false);
      }
    } catch (error) {
      console.error("获取知识库列表失败:", error);
    }
  }, []);

  useEffect(() => {
    // setState 仅发生在网络请求返回后，不存在同步级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchKnowledgeBases();
  }, [fetchKnowledgeBases]);

  const handleKbChange = useCallback(async (value: string) => {
    setKbId(value);
    setDocuments([]);
    setEditingId(null);
    setEditingName("");
    if (!value) return;
    try {
      const res = await fetch(`/api/documents?kbId=${encodeURIComponent(value)}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error("获取素材列表失败:", error);
    }
  }, []);

  // 新建知识库，成功后自动选中
  const handleCreateKb = async () => {
    const name = newKbName.trim();
    if (!name || creatingKb) return;
    setCreatingKb(true);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const kb = (await res.json()) as KnowledgeBase;
        setNewKbName("");
        await fetchKnowledgeBases();
        handleKbChange(kb.id);
      } else {
        const data = await res.json();
        alert(`创建失败：${data.error}`);
      }
    } catch {
      alert("创建失败，请稍后重试");
    } finally {
      setCreatingKb(false);
    }
  };

  const refreshDocuments = useCallback(async () => {
    if (!kbId) return;
    try {
      const res = await fetch(`/api/documents?kbId=${encodeURIComponent(kbId)}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error("刷新素材列表失败:", error);
    }
  }, [kbId]);

  // 轮询处理中的素材状态，完成后刷新列表
  useEffect(() => {
    const hasProcessing = documents.some(
      (d) => d.status === "processing" || d.status === "pending",
    );
    if (!hasProcessing || !kbId) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (!pollingRef.current) {
      pollingRef.current = setInterval(() => {
        refreshDocuments();
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [documents, kbId, refreshDocuments]);

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
            newResults.push({ filename: file.name, status: "已存在（跳过）" });
          } else if (res.ok || res.status === 202) {
            newResults.push({
              filename: file.name,
              status: "处理中",
              docId: data.docId,
            });
          } else {
            newResults.push({
              filename: file.name,
              status: `失败：${data.error}`,
            });
          }
        } catch {
          newResults.push({ filename: file.name, status: "上传失败" });
        }
      }

      setResults((prev) => [...newResults, ...prev]);
      setUploading(false);
      e.target.value = "";
      // 上传后立即刷新素材列表，让新文档以“处理中”状态出现
      refreshDocuments();
    },
    [kbId, refreshDocuments],
  );

  const handleDelete = useCallback(
    async (doc: DocumentItem) => {
      if (!window.confirm(`确定删除「${doc.filename}」吗？该操作不可恢复。`)) {
        return;
      }
      try {
        const res = await fetch(`/api/documents/${doc.id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
        } else {
          const data = await res.json();
          alert(`删除失败：${data.error}`);
        }
      } catch {
        alert("删除失败，请稍后重试");
      }
    },
    [],
  );

  const startRename = useCallback((doc: DocumentItem) => {
    setEditingId(doc.id);
    setEditingName(doc.filename);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName("");
  }, []);

  const submitRename = useCallback(
    async (doc: DocumentItem) => {
      const filename = editingName.trim();
      if (!filename || filename === doc.filename) {
        cancelRename();
        return;
      }
      try {
        const res = await fetch(`/api/documents/${doc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename }),
        });
        if (res.ok) {
          setDocuments((prev) =>
            prev.map((d) => (d.id === doc.id ? { ...d, filename } : d)),
          );
          cancelRename();
        } else {
          const data = await res.json();
          alert(`重命名失败：${data.error}`);
        }
      } catch {
        alert("重命名失败，请稍后重试");
      }
    },
    [editingName, cancelRename],
  );

  const getResultStatusClass = (status: string) => {
    if (status === "处理中") return styles.statusBlue;
    if (status.includes("失败")) return styles.statusRed;
    return styles.statusNeutral;
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.eyebrowRow}>
            <span className={styles.eyebrow}>KNOWLEDGE BASE · DOCUMENTS</span>
            <BackHome />
          </div>
          <h1 className={styles.title}>文档管理</h1>
          <p className={styles.subtitle}>
            创建知识库、上传素材并管理文档的解析与索引状态
          </p>
        </header>

        <section className={styles.card} aria-label="知识库与上传">
          <div className={styles.sectionBlock}>
            <label className={styles.label} htmlFor="kb-select">
              知识库
            </label>
            <select
              id="kb-select"
              name="knowledgeBase"
              value={kbId}
              onChange={(e) => handleKbChange(e.target.value)}
              className={styles.selectInput}
              disabled={loadingKbs}
            >
              <option value="">{loadingKbs ? "加载中…" : "选择知识库"}</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
            <div className={styles.newKbRow}>
              <input
                type="text"
                name="newKnowledgeBase"
                autoComplete="off"
                className={styles.textInput}
                placeholder="输入新知识库名称，例如：产品资料库…"
                value={newKbName}
                onChange={(e) => setNewKbName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateKb();
                }}
              />
              <button
                className={styles.createButton}
                onClick={handleCreateKb}
                disabled={!newKbName.trim() || creatingKb}
              >
                {creatingKb ? "创建中…" : "新建知识库"}
              </button>
            </div>
          </div>

          <div className={styles.sectionBlock}>
            <div className={styles.label}>上传文档</div>
            <label className={styles.dropzone}>
              <svg
                className={styles.uploadIcon}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M12 16V4m0 0L7 9m5-5l5 5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <span className={styles.dropzoneText}>
                {uploading
                  ? "正在上传…"
                  : kbId
                    ? "点击选择文件，可多选上传"
                    : "请先选择知识库后再上传"}
              </span>
              <span className={styles.helpText}>
                支持 PDF、Word、Excel、TXT、Markdown
              </span>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md"
                onChange={handleUpload}
                disabled={!kbId || uploading}
                className={styles.fileInput}
              />
            </label>
          </div>
        </section>

        {results.length > 0 && (
          <section className={styles.panel} aria-label="上传结果">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>上传结果</h2>
            </div>
            <ul className={styles.plainList} aria-live="polite">
              {results.map((r, i) => (
                <li key={i} className={styles.simpleRow}>
                  <span className={styles.ellipsis}>{r.filename}</span>
                  <span
                    className={`${styles.inlineStatus} ${getResultStatusClass(r.status)}`}
                  >
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {kbId && (
          <section className={styles.panel} aria-label="素材列表">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>素材列表</h2>
              <span className={styles.countBadge}>{documents.length}</span>
            </div>
            {documents.length === 0 ? (
              <div className={styles.emptyState}>
                <svg
                  className={styles.emptyIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 3v5h5M9 13h6M9 17h6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <p className={styles.emptyText}>暂无素材，请上传文档</p>
              </div>
            ) : (
              <ul className={styles.docList} aria-live="polite">
                {documents.map((doc) => (
                  <li key={doc.id} className={styles.docItem}>
                    <div className={styles.docMain}>
                      <div className={styles.docTitleRow}>
                        <span
                          className={styles.typeBadge}
                          translate="no"
                        >
                          {doc.fileType.toUpperCase()}
                        </span>
                        {editingId === doc.id ? (
                          <input
                            className={styles.renameInput}
                            name="documentFilename"
                            autoComplete="off"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitRename(doc);
                              if (e.key === "Escape") cancelRename();
                            }}
                            autoFocus
                          />
                        ) : (
                          <span className={styles.docName} title={doc.filename}>
                            {doc.filename}
                          </span>
                        )}
                      </div>
                      <span className={styles.docMeta}>
                        <span className={styles.metaNumber}>
                          {doc.chunkCount}
                        </span>
                        个分块 · {dateFormatter.format(new Date(doc.createdAt))}
                      </span>
                    </div>
                    <div className={styles.docActions}>
                      <StatusPill status={doc.status} />
                      {editingId === doc.id ? (
                        <>
                          <button
                            className={styles.actionButton}
                            onClick={() => submitRename(doc)}
                          >
                            保存
                          </button>
                          <button
                            className={styles.actionButton}
                            onClick={cancelRename}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={styles.actionButton}
                            onClick={() => startRename(doc)}
                          >
                            重命名
                          </button>
                          <button
                            className={`${styles.actionButton} ${styles.deleteButton}`}
                            onClick={() => handleDelete(doc)}
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
