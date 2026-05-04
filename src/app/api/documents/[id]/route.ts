import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const doc = result[0];
    return NextResponse.json({
      id: doc!.id,
      filename: doc!.filename,
      fileType: doc!.fileType,
      status: doc!.status,
      contentHash: doc!.contentHash,
      createdAt: doc!.createdAt,
    });
  } catch (error) {
    console.error('Document status query error:', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}
