import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as xlsx from "xlsx";
import { fileTypeFromBuffer } from "file-type";
import { readFile } from "fs/promises";
import path from "path";

export interface ParsedDocument {
  content: string;
  pages: { pageNum: number; content: string }[];
  metadata: { title?: string; author?: string };
}

// Magic bytes validation: ext -> accepted MIME types
const MIME_TYPE_MAP: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  doc: ["application/msword"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: ["application/vnd.ms-excel"],
  txt: ["text/plain"],
  md: ["text/plain", "text/markdown"],
};

export async function validateFileType(
  buffer: Buffer,
  ext: string,
): Promise<boolean> {
  const fileType = await fileTypeFromBuffer(buffer);
  const accepted = MIME_TYPE_MAP[ext];
  if (!accepted) return false;
  // If file-type cannot detect (e.g. plain text), fall back to extension-only for text files
  if (!fileType) {
    return ext === "txt" || ext === "md";
  }
  return accepted.includes(fileType.mime);
}

function cleanText(text: string): string {
  // 首先过滤 null 字符，然后再清理空白
  return text
    .replace(/\0/g, "")
    .replace(/\x00/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const pages = result.pages.map((p) => ({
    pageNum: p.num,
    content: cleanText(p.text),
  }));

  return {
    content: result.text,
    pages:
      pages.length > 0
        ? pages
        : [{ pageNum: 1, content: cleanText(result.text) }],
    metadata: {},
  };
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  const paragraphs = result.value.split("\n\n").filter((p) => p.trim());

  return {
    content: result.value,
    pages: paragraphs.map((content, i) => ({
      pageNum: i + 1,
      content: cleanText(content),
    })),
    metadata: {},
  };
}

export async function parseExcel(buffer: Buffer): Promise<ParsedDocument> {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const pages: { pageNum: number; content: string }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = xlsx.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      pages.push({
        pageNum: pages.length + 1,
        content: `[${sheetName}]\n${cleanText(csv)}`,
      });
    }
  }

  return {
    content: pages.map((p) => p.content).join("\n"),
    pages,
    metadata: {},
  };
}

export async function parseTextOrMd(filePath: string): Promise<ParsedDocument> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const pages: { pageNum: number; content: string }[] = [];
  let currentPage = "";
  let pageNum = 0;

  for (const line of lines) {
    // Markdown headings start new sections
    if (line.startsWith("#") && currentPage.trim()) {
      pageNum++;
      pages.push({ pageNum, content: cleanText(currentPage) });
      currentPage = "";
    }
    currentPage += line + "\n";
  }

  if (currentPage.trim()) {
    pageNum++;
    pages.push({ pageNum, content: cleanText(currentPage) });
  }

  return { content: cleanText(content), pages, metadata: {} };
}

export async function parseFile(
  filePath: string,
  buffer: Buffer,
  fileType: string,
): Promise<ParsedDocument> {
  switch (fileType) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
    case "doc":
      return parseDocx(buffer);
    case "xlsx":
    case "xls":
      return parseExcel(buffer);
    case "txt":
    case "md":
      return parseTextOrMd(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

export function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return ext;
}
