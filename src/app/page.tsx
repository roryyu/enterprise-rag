import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>企业知识库问答系统</h1>
          <p className={styles.subtitle}>Enterprise RAG Knowledge Base</p>
        </div>
        <div className={styles.links}>
          <Link href="/chat" className={styles.linkPrimary}>
            开始问答
          </Link>
          <Link href="/documents" className={styles.linkSecondary}>
            文档管理
          </Link>
        </div>
      </div>
    </div>
  );
}
