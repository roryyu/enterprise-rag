import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "企业知识库问答系统",
  description: "Enterprise RAG Knowledge Base Q&A System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
