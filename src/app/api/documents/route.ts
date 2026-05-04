import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { db } from '@/lib/db';
import { documents, chunks } from '@/lib/db/schema';
import { parseFile, getFileType, validateFileType } from '@/lib/ingestion/parser';
import { chunkDocument } from '@/lib/ingestion/chunker';
import { generateEmbeddings, extractKeywords } from '@/lib/ingestion/embedder';
import { checkPermission, getDepartmentFromRequest } from '@/lib/auth/permissions';
import { eq, and } from 'drizzle-orm';

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || '50')) * 1024 * 1024;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const kbId = formData.get('kbId') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!kbId) {
    return NextResponse.json({ error: 'kbId is required' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large' }, { status: 400 });
  }

  const fileType = getFileType(file.name);
  const supportedTypes = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md'];
  if (!supportedTypes.includes(fileType)) {
    return NextResponse.json({ error: `Unsupported file type: ${fileType}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const typeValid = await validateFileType(buffer, fileType);
  if (!typeValid) {
    return NextResponse.json({ error: 'File content does not match extension' }, { status: 400 });
  }

  const department = getDepartmentFromRequest(request);
  const canWrite = await checkPermission(kbId, department, 'write');
  if (!canWrite) {
    return NextResponse.json({ error: 'Forbidden: no write permission' }, { status: 403 });
  }

  try {
    const contentHash = createHash('sha256').update(buffer).digest('hex');

    // Dedup check
    const existing = await db
      .select()
      .from(documents)
      .where(and(eq(documents.kbId, kbId), eq(documents.contentHash, contentHash)))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Document already exists', docId: existing[0]!.id },
        { status: 409 }
      );
    }

    // Save file
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, `${contentHash}.${fileType}`);
    await writeFile(filePath, buffer);

    // Create document record
    const [doc] = await db
      .insert(documents)
      .values({
        kbId,
        filename: file.name,
        fileType,
        contentHash,
        status: 'processing',
      })
      .returning();

    // Parse & chunk (async, non-blocking for response)
    processDocument(doc!.id, filePath, fileType, kbId).catch(console.error);

    return NextResponse.json({ docId: doc!.id, status: 'processing' }, { status: 202 });
  } catch (error) {
    console.error('Document upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

async function processDocument(
  docId: string,
  filePath: string,
  fileType: string,
  kbId: string
) {
  try {
    const buffer = await import('fs/promises').then((fs) => fs.readFile(filePath));
    const parsed = await parseFile(filePath, buffer, fileType);
    const chunked = chunkDocument(parsed.pages);

    if (chunked.length === 0) {
      await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, docId));
      return;
    }

    // Generate embeddings in batch
    const texts = chunked.map((c) => c.content);
    const embeddings = await generateEmbeddings(texts);

    // Extract keywords for each chunk
    const keywordLists = chunked.map((c) => extractKeywords(c.content));

    // Insert chunks
    await db.insert(chunks).values(
      chunked.map((chunk, i) => ({
        docId,
        kbId,
        content: chunk.content,
        pageNum: chunk.pageNum,
        sectionTitle: chunk.sectionTitle,
        chunkIndex: chunk.chunkIndex,
        embedding: embeddings[i]!,
        keywords: keywordLists[i]!,
      }))
    );

    // Update document status
    await db.update(documents).set({ status: 'done' }).where(eq(documents.id, docId));
  } catch (error) {
    console.error('Document processing error:', error);
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, docId));
  }
}
