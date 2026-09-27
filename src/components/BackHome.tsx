import Link from "next/link";
import styles from "./BackHome.module.css";

/** 返回首页入口（home 图标 + 文字），用于各子页面顶部栏 */
export default function BackHome() {
  return (
    <Link href="/" className={styles.link} title="返回首页" aria-label="返回首页">
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 11.5L12 4l9 7.5M5.5 10v8.5A1.5 1.5 0 007 20h3v-5h4v5h3a1.5 1.5 0 001.5-1.5V10"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.text}>首页</span>
    </Link>
  );
}
