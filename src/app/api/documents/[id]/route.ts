import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { documents, chunks } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  getIdentityFromRequest,
  checkPermission,
} from '@/lib/auth/permissions';

/** 按 ID 获取未删除文档并校验访问权限 */
async function loadAuthorizedDoc(
  request: NextRequest,
  id: string,
  access: 'read' | 'write',
) {
  const identity = await getIdentityFromRequest(request);

  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1);

  const doc = rows[0];
  if (!doc) {
    return { error: NextResponse.json({ error: 'Document not found' }, { status: 404 }) };
  }

  const allowed = await checkPermission(doc.kbId ?? '', identity.department, access);
  if (!allowed) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { doc };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let result;
  try {
    result = await loadAuthorizedDoc(request, id, 'read');
  } catch {
    return NextResponse.json(
      { error: '未提供有效的身份凭证' },
      { status: 401 },
    );
  }
  if (result.error) return result.error;

  const doc = result.doc!;
  return NextResponse.json({
    id: doc.id,
    kbId: doc.kbId,
    filename: doc.filename,
    fileType: doc.fileType,
    status: doc.status,
    contentHash: doc.contentHash,
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

// PATCH: 更新文档元数据（当前支持重命名）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let result;
  try {
    result = await loadAuthorizedDoc(request, id, 'write');
  } catch {
    return NextResponse.json(
      { error: '未提供有效的身份凭证' },
      { status: 401 },
    );
  }
  if (result.error) return result.error;

  const body = (await request.json()) as { filename?: string };
  const filename = body.filename?.trim();
  if (!filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(documents)
      .set({ filename, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning({
        id: documents.id,
        filename: documents.filename,
        updatedAt: documents.updatedAt,
      });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Document update error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

// DELETE: 删除文档及其全部分块（硬删除，释放 (kb_id, content_hash) 唯一约束槽位）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let result;
  try {
    result = await loadAuthorizedDoc(request, id, 'write');
  } catch {
    return NextResponse.json(
      { error: '未提供有效的身份凭证' },
      { status: 401 },
    );
  }
  if (result.error) return result.error;

  try {
    await db.delete(chunks).where(eq(chunks.docId, id));
    await db.delete(documents).where(eq(documents.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Document delete error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
