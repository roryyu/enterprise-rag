import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getFileType, validateFileType } from "@/lib/ingestion/parser";
import {
  getIdentityFromRequest,
  checkPermission,
} from "@/lib/auth/permissions";
import { eq, and, isNull } from "drizzle-orm";
import { createIngestionTask } from "@/lib/ingestion/task-manager";

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE =
  parseInt(process.env.MAX_FILE_SIZE_MB || "50") * 1024 * 1024;
const SUPPORTED_TYPES = ["pdf", "docx", "doc", "xlsx", "xls", "txt", "md"];

export async function POST(request: NextRequest) {
  // 1) 身份认证（dev 模式允许请求头，生产必须 JWT）
  let identity;
  try {
    identity = await getIdentityFromRequest(request);
  } catch {
    return NextResponse.json(
      { error: "未提供有效的身份凭证" },
      { status: 401 },
    );
  }

  // 2) 解析并校验上传内容
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const kbId = formData.get("kbId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!kbId) {
    return NextResponse.json({ error: "kbId is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const fileType = getFileType(file.name);
  if (!SUPPORTED_TYPES.includes(fileType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${fileType}` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const typeValid = await validateFileType(buffer, fileType);
  if (!typeValid) {
    return NextResponse.json(
      { error: "File content does not match extension" },
      { status: 400 },
    );
  }

  // 3) 资源级权限：必须对目标知识库有写权限
  const canWrite = await checkPermission(kbId, identity.department, "write");
  if (!canWrite) {
    return NextResponse.json(
      { error: "Forbidden: no write permission for this knowledge base" },
      { status: 403 },
    );
  }

  try {
    const contentHash = createHash("sha256").update(buffer).digest("hex");

    // 4) 去重：同库同内容且未软删除的文档直接复用
    const existing = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.kbId, kbId),
          eq(documents.contentHash, contentHash),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Document already exists", docId: existing[0]!.id },
        { status: 409 },
      );
    }

    // 5) 保存原文件
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, `${contentHash}.${fileType}`);
    await writeFile(filePath, buffer);

    // 6) 创建文档记录（processing：索引完成前不对外可见）
    const [doc] = await db
      .insert(documents)
      .values({
        kbId,
        filename: file.name,
        fileType,
        contentHash,
        status: "processing",
        version: 1,
      })
      .returning({ id: documents.id });

    // 7) 创建可靠异步任务并立即返回（进度落 ingestion_tasks，可查可恢复）
    const embeddingModel =
      process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-v3";
    await createIngestionTask(
      doc!.id,
      filePath,
      fileType,
      contentHash,
      kbId,
      embeddingModel,
    );

    return NextResponse.json(
      { docId: doc!.id, status: "processing" },
      { status: 202 },
    );
  } catch (error) {
    console.error("Document upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
