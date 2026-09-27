import Link from "next/link";
import KnowledgeGraphBg from "@/components/KnowledgeGraphBg";
import styles from "./page.module.css";

export default function Home() {
  return (
    <>
      <KnowledgeGraphBg />
      <main className={styles.container}>
        <div className={`${styles.card} glassCard`}>
          <span className={styles.eyebrow}>ENTERPRISE RAG PLATFORM</span>
          <h1 className={styles.title}>企业知识库问答系统</h1>
          <p className={styles.subtitle}>
            上传企业文档，自动解析、分块与向量化，基于私有知识库精准问答
          </p>
          <div className={styles.links}>
            <Link href="/chat" className={styles.linkPrimary}>
              开始问答
            </Link>
            <Link href="/documents" className={styles.linkSecondary}>
              文档管理
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
