import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getIdentityFromRequest,
  checkPermission,
} from '@/lib/auth/permissions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let identity;
  try {
    identity = await getIdentityFromRequest(request);
  } catch {
    return NextResponse.json(
      { error: '未提供有效的身份凭证' },
      { status: 401 },
    );
  }

  try {
    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    const doc = rows[0];
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 资源级鉴权：仅有权读取该知识库的部门可查看文档
    const canRead = await checkPermission(
      doc.kbId ?? '',
      identity.department,
      'read',
    );
    if (!canRead) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
  } catch (error) {
    console.error('Document status query error:', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}
